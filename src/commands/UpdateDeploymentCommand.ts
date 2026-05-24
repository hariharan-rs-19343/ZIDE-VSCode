import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SettingsManager } from '../settings/SettingsManager';
import { StateManager } from '../persistence/StateManager';
import { runCommand } from '../util/processUtil';
import { showError, showInfo } from '../util/notificationUtil';

export class UpdateDeploymentCommand {
    static async run(): Promise<void> {
        const buildSource = await vscode.window.showQuickPick(
            [
                { label: 'Custom Build (Remote URL)', description: 'Download from a remote URL' },
                { label: 'Local Build (Zip File)', description: 'Select a local zip file' }
            ],
            { placeHolder: 'Select build source' }
        );

        if (!buildSource) { return; }

        if (buildSource.label.startsWith('Custom')) {
            await this.runCustomBuild();
        } else {
            await this.runLocalBuild();
        }
    }

    static async runCustomBuild(): Promise<void> {
        const { projectDir, server } = await this.resolveContext() ?? {};
        if (!projectDir || !server) { return; }

        const url = await vscode.window.showInputBox({
            prompt: 'Enter build download URL',
            placeHolder: 'https://...'
        });
        if (!url) { return; }

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'ZIDE: Custom Build', cancellable: true },
            async (progress, token) => {
                const settings = SettingsManager.getInstance();
                await settings.ensureSecretsLoaded();

                progress.report({ message: 'Downloading build...' });
                const buildZipPath = path.join(projectDir, 'build_update.zip');

                const wgetUser = settings.wgetUsername;
                const wgetPass = settings.wgetPassword;

                let downloadCmd: string;
                if (wgetUser && wgetPass) {
                    downloadCmd = `curl -fL -o "${buildZipPath}" -u "${wgetUser}:${wgetPass}" "${url}"`;
                } else {
                    downloadCmd = `curl -fL -o "${buildZipPath}" "${url}"`;
                }

                const dlResult = await runCommand(downloadCmd);
                if (token.isCancellationRequested) { return; }
                if (dlResult.exitCode !== 0) {
                    showError(`Download failed (HTTP error or network issue): ${dlResult.stderr}`);
                    return;
                }

                if (!this.validateZipFile(buildZipPath)) { return; }

                await this.deployZip(buildZipPath, projectDir, server, progress);

                if (fs.existsSync(buildZipPath)) {
                    fs.unlinkSync(buildZipPath);
                }

                showInfo('Deployment updated successfully');
            }
        );
    }

    static async runLocalBuild(): Promise<void> {
        const { projectDir, server } = await this.resolveContext() ?? {};
        if (!projectDir || !server) { return; }

        const zipUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            filters: { 'Zip files': ['zip'] },
            openLabel: 'Select Build Zip'
        });
        if (!zipUri || zipUri.length === 0) { return; }
        const buildZipPath = zipUri[0].fsPath;

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'ZIDE: Local Build', cancellable: false },
            async (progress) => {
                await this.deployZip(buildZipPath, projectDir, server, progress);
                showInfo('Deployment updated successfully');
            }
        );
    }

    private static async resolveContext(): Promise<{ projectDir: string; server: import('../model/TomcatServer').TomcatServer } | undefined> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showError('No workspace folder open');
            return undefined;
        }
        const projectDir = workspaceFolder.uri.fsPath;

        const mapping = StateManager.getInstance().getMappingForProject(projectDir);
        if (mapping) {
            const server = StateManager.getInstance().getServer(mapping.serverId);
            if (server) { return { projectDir, server }; }
        }

        const { PathResolver } = require('../parser/PathResolver');
        const zideResourcesPath = PathResolver.resolveZideResourcesPath(projectDir);
        if (!zideResourcesPath) {
            showError('No server configured and no .zide_resources found');
            return undefined;
        }

        const serviceXmlPath = path.join(zideResourcesPath, 'service.xml');
        if (!fs.existsSync(serviceXmlPath)) {
            showError('No server configured and service.xml not found');
            return undefined;
        }

        const svcContent = fs.readFileSync(serviceXmlPath, 'utf-8');
        const deployFolder = svcContent.match(/name="ZIDE\.DEPLOYMENT_FOLDER"\s+value="([^"]*)"/)?.[1] || '';
        const parentService = svcContent.match(/name="ZIDE\.PARENT_SERVICE"\s+value="([^"]*)"/)?.[1] || '';

        if (!deployFolder) {
            showError('ZIDE.DEPLOYMENT_FOLDER not found in service.xml. Add a server first.');
            return undefined;
        }

        const tomcatPath = path.join(deployFolder, 'AdventNet', 'Sas', 'tomcat');
        const serverPath = fs.existsSync(tomcatPath) ? tomcatPath : deployFolder;

        const tempServer: import('../model/TomcatServer').TomcatServer = {
            id: '', name: parentService || 'ZIDE',
            path: serverPath, status: 'stopped', port: 8080,
            debugPort: 8787, shutdownPort: 9285, contextPath: '',
            deploymentDir: deployFolder, zideResourcesPath,
            zidePropertiesPath: path.join(zideResourcesPath, 'zide_properties.xml'),
            serviceName: parentService, antHome: '', javaHome: '', vmArguments: ''
        };

        return { projectDir, server: tempServer };
    }

    private static validateZipFile(zipPath: string): boolean {
        if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size === 0) {
            showError('Download failed: file is empty or missing');
            return false;
        }
        const header = Buffer.alloc(4);
        const fd = fs.openSync(zipPath, 'r');
        fs.readSync(fd, header, 0, 4, 0);
        fs.closeSync(fd);
        if (header[0] !== 0x50 || header[1] !== 0x4B) {
            const content = fs.readFileSync(zipPath, 'utf-8').substring(0, 200);
            fs.unlinkSync(zipPath);
            showError(`Download did not return a valid zip file. Server response: ${content}`);
            return false;
        }
        return true;
    }

    /**
     * 6-step deployment pipeline matching IntelliJ's UpdateDeploymentAction.runDeploymentCore():
     * 1. Stop server if running
     * 2. Copy + extract build zip to deployment folder
     * 3. Extract ROOT.war as {PARENT_SERVICE}, other .war files by name
     * 4. Delete all .war files
     * 5. Run ANT hooks (precreation, postcreation, zidemodule)
     * 6. Patch deployment config files
     */
    private static async deployZip(
        buildZipPath: string,
        projectDir: string,
        server: import('../model/TomcatServer').TomcatServer,
        progress: vscode.Progress<{ message?: string }>
    ): Promise<void> {
        const deploymentDir = server.deploymentDir;
        if (!deploymentDir) {
            showError('No deployment directory configured');
            return;
        }

        const { TomcatManager } = require('../tomcat/TomcatManager');
        const outputChannel = TomcatManager.getInstance().getOutputChannel();
        outputChannel.clear();
        outputChannel.show(true);

        // Read PARENT_SERVICE from service.xml
        let parentService = '';
        if (server.zideResourcesPath) {
            const svcXmlPath = path.join(server.zideResourcesPath, 'service.xml');
            if (fs.existsSync(svcXmlPath)) {
                const svcContent = fs.readFileSync(svcXmlPath, 'utf-8');
                const m = svcContent.match(/name="ZIDE\.PARENT_SERVICE"\s+value="([^"]*)"/);
                if (m?.[1]) { parentService = m[1]; }
            }
        }
        if (!parentService) { parentService = server.serviceName || path.basename(projectDir); }

        outputChannel.appendLine('=== Update Deployment ===');
        outputChannel.appendLine(`Zip file: ${buildZipPath}`);
        outputChannel.appendLine(`Deploy to: ${deploymentDir}`);
        outputChannel.appendLine(`Service: ${parentService}\n`);

        // [Stop] Stop server if running
        const { isPortAvailable } = require('../util/portUtil');
        const portInUse = !(await isPortAvailable(server.port));
        if (portInUse) {
            progress.report({ message: '[Stop] Stopping server...' });
            outputChannel.appendLine('[Stop] Server is running. Stopping...');
            await TomcatManager.getInstance().stopServer(server);
            outputChannel.appendLine('[Stop] Server stopped.\n');
        }

        // [1/6] Copy zip to deployment folder
        progress.report({ message: '[1/6] Copying build zip...' });
        fs.mkdirSync(deploymentDir, { recursive: true });
        const destZip = path.join(deploymentDir, path.basename(buildZipPath));
        fs.copyFileSync(buildZipPath, destZip);
        outputChannel.appendLine(`[1/6] Copied ${path.basename(buildZipPath)} to ${deploymentDir}`);

        // [2/6] Extract zip
        progress.report({ message: '[2/6] Extracting build...' });
        outputChannel.appendLine(`[2/6] Extracting ${path.basename(buildZipPath)}...`);
        const unzipResult = await runCommand(`unzip -o "${destZip}" -d "${deploymentDir}"`);
        if (unzipResult.exitCode !== 0) {
            outputChannel.appendLine(`Extract FAILED: ${unzipResult.stderr}`);
            showError(`Extraction failed: ${unzipResult.stderr}`);
            return;
        }
        outputChannel.appendLine('Extracted successfully.\n');

        // [3/6] Extract ROOT.war as PARENT_SERVICE, other .war files by name
        const webappsDir = path.join(deploymentDir, 'AdventNet', 'Sas', 'tomcat', 'webapps');
        const altWebapps = path.join(deploymentDir, 'webapps');
        const actualWebapps = fs.existsSync(webappsDir) ? webappsDir : (fs.existsSync(altWebapps) ? altWebapps : '');

        if (!actualWebapps) {
            outputChannel.appendLine('ERROR: webapps directory not found after extraction');
            showError('webapps directory not found');
            return;
        }

        const rootWar = path.join(actualWebapps, 'ROOT.war');
        if (fs.existsSync(rootWar)) {
            progress.report({ message: `[3/6] Extracting ROOT.war as ${parentService}...` });
            const productDir = path.join(actualWebapps, parentService);
            if (fs.existsSync(productDir)) {
                fs.rmSync(productDir, { recursive: true, force: true });
            }
            fs.mkdirSync(productDir, { recursive: true });
            outputChannel.appendLine(`[3/6] Unzipping ROOT.war as ${parentService}...`);
            const warResult = await runCommand(`unzip -o "${rootWar}" -d "${productDir}"`);
            if (warResult.exitCode !== 0) {
                outputChannel.appendLine(`ROOT.war extraction FAILED: ${warResult.stderr}`);
                showError('ROOT.war extraction failed');
                return;
            }
            outputChannel.appendLine(`ROOT.war extracted to ${parentService}/\n`);
        }

        // Extract other .war files
        const otherWars = fs.readdirSync(actualWebapps).filter(f => f.endsWith('.war') && f !== 'ROOT.war');
        for (const war of otherWars) {
            const warPath = path.join(actualWebapps, war);
            const warName = war.replace('.war', '');
            const warDir = path.join(actualWebapps, warName);
            if (fs.existsSync(warDir)) {
                fs.rmSync(warDir, { recursive: true, force: true });
            }
            fs.mkdirSync(warDir, { recursive: true });
            outputChannel.appendLine(`Extracting ${war} as ${warName}...`);
            await runCommand(`unzip -o "${warPath}" -d "${warDir}"`);
        }

        // [4/6] Delete all .war files
        progress.report({ message: '[4/6] Cleaning up WAR files...' });
        outputChannel.appendLine('[4/6] Deleting *.war files from webapps...');
        const allWars = fs.readdirSync(actualWebapps).filter(f => f.endsWith('.war'));
        for (const war of allWars) {
            fs.unlinkSync(path.join(actualWebapps, war));
            outputChannel.appendLine(`Deleted: ${war}`);
        }
        if (fs.existsSync(destZip)) { fs.unlinkSync(destZip); }
        outputChannel.appendLine('WAR files cleaned up.\n');

        // [5/6] Run ANT hooks
        progress.report({ message: '[5/6] Running ANT hooks...' });
        outputChannel.appendLine('[5/6] Running ANT hooks...');
        const { AntResolver } = require('../deploysync/AntResolver');
        const { PathResolver } = require('../parser/PathResolver');
        const antHome = AntResolver.resolveAntHome(server.antHome);
        if (antHome) {
            const repositoryPath = PathResolver.readRepositoryPath(projectDir) ?? projectDir;
            const tomcatPath = path.join(deploymentDir, 'AdventNet', 'Sas', 'tomcat');
            const deploymentPath = fs.existsSync(tomcatPath) ? tomcatPath : deploymentDir;

            const hookProps: Record<string, string> = {
                'REPOSITORY_PATH': repositoryPath,
                'DEPLOYMENT_PATH': deploymentPath,
                'ZIDE.PARENT_SERVICE': parentService
            };

            const zideHookBuildXml = path.join(repositoryPath, '.zide_resources', 'zide_hook', 'build.xml');
            const zideBuildBuildXml = path.join(repositoryPath, '.zide_resources', 'zide_build', 'build.xml');

            if (fs.existsSync(zideHookBuildXml)) {
                outputChannel.appendLine('  Running pre-creation hook...');
                const hookBaseDir = path.join(repositoryPath, '.zide_resources', 'zide_hook');
                const r = await AntResolver.runAnt(antHome, zideHookBuildXml, ['clone', '-Dtarget=precreationhook'], { ...hookProps, 'basedir': hookBaseDir }, repositoryPath);
                if (r.output) { outputChannel.appendLine(r.output); }
                outputChannel.appendLine(r.success ? '  Pre-creation hook completed.\n' : '  Pre-creation hook FAILED.\n');
            }
            if (fs.existsSync(zideBuildBuildXml)) {
                outputChannel.appendLine('  Running post-creation hook...');
                const buildBaseDir = path.join(repositoryPath, '.zide_resources', 'zide_build');
                const r = await AntResolver.runAnt(antHome, zideBuildBuildXml, ['clone', '-Dtarget=postcreationhook'], { ...hookProps, 'basedir': buildBaseDir }, repositoryPath);
                if (r.output) { outputChannel.appendLine(r.output); }
                outputChannel.appendLine(r.success ? '  Post-creation hook completed.\n' : '  Post-creation hook FAILED.\n');
            }
            if (fs.existsSync(zideHookBuildXml)) {
                outputChannel.appendLine('  Running zide module hook...');
                const hookBaseDir = path.join(repositoryPath, '.zide_resources', 'zide_hook');
                const r = await AntResolver.runAnt(antHome, zideHookBuildXml, ['clone', '-Dtarget=zidemodulehook'], { ...hookProps, 'basedir': hookBaseDir }, repositoryPath);
                if (r.output) { outputChannel.appendLine(r.output); }
                outputChannel.appendLine(r.success ? '  Zide module hook completed.\n' : '  Zide module hook FAILED.\n');
            }
        } else {
            outputChannel.appendLine('  ANT not found, skipping hooks.\n');
        }

        // [6/6] Patch deployment configs
        progress.report({ message: '[6/6] Patching configurations...' });
        outputChannel.appendLine('[6/6] Patching deployment config files...');
        const { DeploymentConfigPatcher } = require('../zide/DeploymentConfigPatcher');
        await DeploymentConfigPatcher.patchAll(server);
        outputChannel.appendLine('Config patching complete.\n');

        outputChannel.appendLine('=== Deployment update completed ===');
    }
}
