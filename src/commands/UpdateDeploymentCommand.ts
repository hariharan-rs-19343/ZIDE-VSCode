import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SettingsManager } from '../settings/SettingsManager';
import { DeploymentConfigPatcher } from '../zide/DeploymentConfigPatcher';
import { AntResolver } from '../deploysync/AntResolver';
import { StateManager } from '../persistence/StateManager';
import { runCommand } from '../util/processUtil';
import { showError, showInfo } from '../util/notificationUtil';
import { PathResolver } from '../parser/PathResolver';

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
        if (!mapping) {
            showError('No server configured for this project');
            return undefined;
        }
        const server = StateManager.getInstance().getServer(mapping.serverId);
        if (!server) {
            showError('Server not found');
            return undefined;
        }

        return { projectDir, server };
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

        progress.report({ message: 'Extracting build...' });
        const unzipResult = await runCommand(`unzip -o "${buildZipPath}" -d "${deploymentDir}"`);
        if (unzipResult.exitCode !== 0) {
            showError(`Extraction failed: ${unzipResult.stderr}`);
            return;
        }

        progress.report({ message: 'Extracting WAR files...' });
        const webappsDir = path.join(deploymentDir, 'webapps');
        if (fs.existsSync(webappsDir)) {
            const warFiles = fs.readdirSync(webappsDir).filter(f => f.endsWith('.war'));
            for (const war of warFiles) {
                const warPath = path.join(webappsDir, war);
                const warDir = path.join(webappsDir, war.replace('.war', ''));
                fs.mkdirSync(warDir, { recursive: true });
                await runCommand(`unzip -o "${warPath}" -d "${warDir}"`);
            }
        }

        progress.report({ message: 'Running ANT hooks...' });
        const antHome = AntResolver.resolveAntHome(server.antHome);
        if (antHome) {
            const repositoryPath = PathResolver.readRepositoryPath(projectDir) ?? projectDir;
            const zideHookBuildXml = path.join(repositoryPath, '.zide_resources', 'zide_hook', 'build.xml');
            const zideBuildBuildXml = path.join(repositoryPath, '.zide_resources', 'zide_build', 'build.xml');

            const hookProps: Record<string, string> = {
                'REPOSITORY_PATH': repositoryPath,
                'DEPLOYMENT_PATH': server.path,
                'ZIDE.PARENT_SERVICE': server.serviceName
            };

            if (fs.existsSync(zideHookBuildXml)) {
                const hookBaseDir = path.join(repositoryPath, '.zide_resources', 'zide_hook');
                await AntResolver.runAnt(antHome, zideHookBuildXml, ['clone', '-Dtarget=precreationhook'], {
                    ...hookProps,
                    'basedir': hookBaseDir
                }, repositoryPath);
            }
            if (fs.existsSync(zideBuildBuildXml)) {
                const buildBaseDir = path.join(repositoryPath, '.zide_resources', 'zide_build');
                await AntResolver.runAnt(antHome, zideBuildBuildXml, ['clone', '-Dtarget=postcreationhook'], {
                    ...hookProps,
                    'basedir': buildBaseDir
                }, repositoryPath);
            }
            if (fs.existsSync(zideHookBuildXml)) {
                const hookBaseDir = path.join(repositoryPath, '.zide_resources', 'zide_hook');
                await AntResolver.runAnt(antHome, zideHookBuildXml, ['clone', '-Dtarget=zidemodulehook'], {
                    ...hookProps,
                    'basedir': hookBaseDir
                }, repositoryPath);
            }
        }

        progress.report({ message: 'Patching configurations...' });
        await DeploymentConfigPatcher.patchAll(server);
    }
}
