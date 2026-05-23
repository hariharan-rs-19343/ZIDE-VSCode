import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CmToolApiClient, CmToolProduct } from './CmToolApiClient';
import { SettingsManager } from '../settings/SettingsManager';
import { AntResolver } from '../deploysync/AntResolver';
import { runCommand } from '../util/processUtil';
import { showError, showInfo } from '../util/notificationUtil';

export class ProjectCreator {
    static async run(): Promise<void> {
        let createdProjectDir: string | undefined;
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'ZIDE: Creating New Project',
                cancellable: true
            },
            async (progress, token) => {
                try {
                    createdProjectDir = await this.createProject(progress, token);
                } catch (e) {
                    if (e instanceof Error && e.message === 'cancelled') { return; }
                    showError(`Project creation failed: ${e}`);
                }
            }
        );

        if (createdProjectDir) {
            await this.collectDeploymentProperties(createdProjectDir);
            await this.runPostPropertiesHooksAndPatch(createdProjectDir);
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(createdProjectDir), { forceNewWindow: true });
        }
    }

    private static resolveHostName(): string {
        const csezDomain = '.csez.zohocorpin.com';
        try {
            const { execSync } = require('child_process');
            const hostname = execSync('hostname', { encoding: 'utf-8' }).trim();
            return hostname.endsWith(csezDomain) ? hostname : `${hostname}${csezDomain}`;
        } catch {
            return `localhost${csezDomain}`;
        }
    }

    private static async collectDeploymentProperties(projectDir: string): Promise<void> {
        const zideResourcesDir = path.join(projectDir, '.zide_resources');
        const propsFile = path.join(zideResourcesDir, 'zide_properties.xml');

        // Read existing props to get current values and service key
        let existingContent = '';
        let serviceKey = path.basename(projectDir);
        if (fs.existsSync(propsFile)) {
            existingContent = fs.readFileSync(propsFile, 'utf-8');
            const keyMatch = existingContent.match(/service\s+key="([^"]*)"/);
            if (keyMatch) { serviceKey = keyMatch[1]; }
        }

        const extractExisting = (key: string): string | undefined => {
            const match = existingContent.match(new RegExp(`name="${key.replace(/\./g, '\\.')}"\\s+value="([^"]*)"`));
            return match?.[1];
        };

        const defaultHostName = this.resolveHostName();
        const userName = process.env['USER'] || '';

        const hostName = await vscode.window.showInputBox({
            prompt: 'Host Name',
            value: extractExisting('ZIDE.HOST_NAME') || defaultHostName
        });
        if (hostName === undefined) { return; }

        const userMail = await vscode.window.showInputBox({
            prompt: 'User Email',
            value: extractExisting('ZIDE.USER_MAIL') || `${userName}@zohocorp.com`
        });
        if (userMail === undefined) { return; }

        const iamServer = await vscode.window.showInputBox({
            prompt: 'IAM Server URL',
            value: extractExisting('ZIDE.IAM_SERVER') || 'https://accounts.csez.zohocorpin.com'
        });
        if (iamServer === undefined) { return; }

        const httpPort = await vscode.window.showInputBox({
            prompt: 'HTTP Port',
            value: extractExisting('ZIDE.HTTP_PORT') || '8080'
        });
        if (httpPort === undefined) { return; }

        const httpsPort = await vscode.window.showInputBox({
            prompt: 'HTTPS Port',
            value: extractExisting('ZIDE.HTTPS_PORT') || '8443'
        });
        if (httpsPort === undefined) { return; }

        const iamServiceName = await vscode.window.showInputBox({
            prompt: 'IAM Service Name',
            value: extractExisting('ZIDE.IAM_SERVICENAME') || serviceKey
        });
        if (iamServiceName === undefined) { return; }

        const currentDbType = extractExisting('ZIDE_DB_TYPE') || 'PGSQL';
        const dbType = await vscode.window.showQuickPick(
            ['PostgreSQL', 'MySQL'],
            { placeHolder: 'Select Database Type' }
        );
        if (!dbType) { return; }

        const dbHost = await vscode.window.showInputBox({
            prompt: 'Database Hostname',
            value: extractExisting('ZIDE_DB_HOST') || 'localhost'
        });
        if (dbHost === undefined) { return; }

        const dbUser = await vscode.window.showInputBox({
            prompt: 'Database Username',
            value: extractExisting('ZIDE_DB_USER') || 'root'
        });
        if (dbUser === undefined) { return; }

        const dbPassword = await vscode.window.showInputBox({
            prompt: 'Database Password',
            password: true,
            value: extractExisting('ZIDE_DB_PASS') || ''
        });
        if (dbPassword === undefined) { return; }

        const dbName = await vscode.window.showInputBox({
            prompt: 'Database Name',
            value: extractExisting('ZIDE_DB_NAME') || ''
        });
        if (dbName === undefined) { return; }

        const dbSchema = await vscode.window.showInputBox({
            prompt: 'Schema Name',
            value: extractExisting('ZIDE.SCHEMA_NAME') || 'jbossdb'
        });
        if (dbSchema === undefined) { return; }

        const dbTypeValue = dbType === 'PostgreSQL' ? 'PGSQL' : 'MYSQL';

        // Save using IntelliJ-compatible XML structure
        const propsContent = `<?xml version="1.0" encoding="UTF-8"?><zide><services><service key="${serviceKey}"><properties><property name="ZIDE.HOST_NAME" value="${hostName}"/><property name="ZIDE.USER_MAIL" value="${userMail}"/><property name="ZIDE.IAM_SERVER" value="${iamServer}"/><property name="ZIDE.HTTP_PORT" value="${httpPort}"/><property name="ZIDE.HTTPS_PORT" value="${httpsPort}"/><property name="ZIDE.IAM_SERVICENAME" value="${iamServiceName}"/><property name="ZIDE.USER_NAME" value="${userName}"/><property name="ZIDE.MACHINE_IP" value="${hostName}"/><property name="ZIDE_DB_TYPE" value="${dbTypeValue}"/><property name="ZIDE_DB_HOST" value="${dbHost}"/><property name="ZIDE_DB_USER" value="${dbUser}"/><property name="ZIDE_DB_PASS" value="${dbPassword}"/><property name="ZIDE_DB_NAME" value="${dbName}"/><property name="ZIDE.SCHEMA_NAME" value="${dbSchema}"/></properties></service></services></zide>`;
        fs.writeFileSync(propsFile, propsContent, 'utf-8');
    }

    private static async runPostPropertiesHooksAndPatch(projectDir: string): Promise<void> {
        const { PathResolver } = require('../parser/PathResolver');
        const { ZideConfigParser } = require('../parser/ZideConfigParser');
        const { DeploymentConfigPatcher } = require('../zide/DeploymentConfigPatcher');

        const zideResourcesPath = PathResolver.resolveZideResourcesPath(projectDir);
        if (!zideResourcesPath) { return; }

        const services = ZideConfigParser.parseServiceXml(path.join(zideResourcesPath, 'service.xml'));
        const serviceName = services[0]?.name || path.basename(projectDir);

        const serviceContent = fs.existsSync(path.join(zideResourcesPath, 'service.xml'))
            ? fs.readFileSync(path.join(zideResourcesPath, 'service.xml'), 'utf-8') : '';
        const deployFolderMatch = serviceContent.match(/name="ZIDE\.DEPLOYMENT_FOLDER"\s+value="([^"]*)"/);
        const deploymentFolder = deployFolderMatch?.[1] || '';

        const antHome = AntResolver.resolveAntHome();
        if (antHome) {
            const repositoryPath = PathResolver.readRepositoryPath(projectDir) ?? projectDir;
            const tomcatDir = deploymentFolder ? path.join(deploymentFolder, 'AdventNet', 'Sas', 'tomcat') : '';
            const hookProps: Record<string, string> = {
                'REPOSITORY_PATH': repositoryPath,
                'DEPLOYMENT_PATH': tomcatDir || deploymentFolder,
                'ZIDE.PARENT_SERVICE': serviceName
            };

            const zideHookBuildXml = path.join(repositoryPath, '.zide_resources', 'zide_hook', 'build.xml');
            const zideBuildBuildXml = path.join(repositoryPath, '.zide_resources', 'zide_build', 'build.xml');

            if (fs.existsSync(zideHookBuildXml)) {
                const hookBaseDir = path.join(repositoryPath, '.zide_resources', 'zide_hook');
                await AntResolver.runAnt(antHome, zideHookBuildXml, ['clone', '-Dtarget=precreationhook'], {
                    ...hookProps, 'basedir': hookBaseDir
                }, repositoryPath);
            }
            if (fs.existsSync(zideBuildBuildXml)) {
                const buildBaseDir = path.join(repositoryPath, '.zide_resources', 'zide_build');
                await AntResolver.runAnt(antHome, zideBuildBuildXml, ['clone', '-Dtarget=postcreationhook'], {
                    ...hookProps, 'basedir': buildBaseDir
                }, repositoryPath);
            }
            if (fs.existsSync(zideHookBuildXml)) {
                const hookBaseDir = path.join(repositoryPath, '.zide_resources', 'zide_hook');
                await AntResolver.runAnt(antHome, zideHookBuildXml, ['clone', '-Dtarget=zidemodulehook'], {
                    ...hookProps, 'basedir': hookBaseDir
                }, repositoryPath);
            }
        }

        if (deploymentFolder) {
            const zidePropsPath = path.join(zideResourcesPath, 'zide_properties.xml');
            if (fs.existsSync(zidePropsPath)) {
                const propsContent = fs.readFileSync(zidePropsPath, 'utf-8');
                const extract = (key: string): string | undefined => {
                    const match = propsContent.match(new RegExp(`name="${key.replace(/\./g, '\\.')}"\\s+value="([^"]*)"`));
                    return match?.[1];
                };

                const tomcatPath = path.join(deploymentFolder, 'AdventNet', 'Sas', 'tomcat');
                const serverPath = fs.existsSync(tomcatPath) ? tomcatPath : deploymentFolder;

                const tempServer = {
                    id: '', name: serviceName, path: serverPath,
                    status: 'stopped' as const, port: parseInt(extract('ZIDE.HTTP_PORT') || '8080', 10),
                    debugPort: 8787, shutdownPort: 9285, contextPath: `/${serviceName}`,
                    deploymentDir: deploymentFolder, zideResourcesPath, zidePropertiesPath: zidePropsPath,
                    serviceName, antHome: '', javaHome: '', vmArguments: ''
                };
                await DeploymentConfigPatcher.patchAll(tempServer);
            }
        }
    }

    private static async createProject(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): Promise<string> {
        const settings = SettingsManager.getInstance();
        await settings.ensureSecretsLoaded();

        // Step 1: Read project name from user
        progress.report({ message: 'Enter project name...', increment: 5 });
        const projectName = await vscode.window.showInputBox({
            prompt: 'Enter project name',
            placeHolder: 'my-project',
            validateInput: (value) => {
                if (!value || !value.trim()) { return 'Project name is required'; }
                if (/[/\\:*?"<>|]/.test(value)) { return 'Invalid characters in project name'; }
                return undefined;
            }
        });
        if (!projectName || token.isCancellationRequested) { throw new Error('cancelled'); }

        // Determine project directory: ~/eclipse-workspace/${name} or ~/VSCode/${name}
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const eclipseWorkspace = path.join(homeDir, 'eclipse-workspace');
        const baseDir = fs.existsSync(eclipseWorkspace) ? eclipseWorkspace : path.join(homeDir, 'VSCode');
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        const projectDir = path.join(baseDir, projectName.trim());

        if (fs.existsSync(projectDir)) {
            showError(`Project directory already exists: ${projectDir}`);
            throw new Error('cancelled');
        }

        // Step 2: Validate CMTool auth token & fetch services
        progress.report({ message: 'Validating CMTool token...', increment: 5 });
        if (!settings.cmToolAuthToken) {
            const action = await vscode.window.showErrorMessage(
                'CMTool auth token not configured',
                'Open Settings'
            );
            if (action === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'zide.cmToolAuthToken');
            }
            throw new Error('cancelled');
        }

        progress.report({ message: 'Fetching services from CMTool...', increment: 5 });
        if (token.isCancellationRequested) { throw new Error('cancelled'); }

        let services: CmToolProduct[];
        try {
            services = await CmToolApiClient.fetchServices();
        } catch (e) {
            showError(`Failed to fetch services: ${e}`);
            throw new Error('cancelled');
        }

        if (services.length === 0) {
            showError('No services found in CMTool');
            throw new Error('cancelled');
        }

        // Step 2: Choose service name
        progress.report({ message: 'Select service...', increment: 5 });
        const selectedService = await vscode.window.showQuickPick(
            services.map(s => ({ label: s.name, description: s.serviceName, product: s })),
            { placeHolder: 'Select a service' }
        );
        if (!selectedService || token.isCancellationRequested) { throw new Error('cancelled'); }

        // Step 3: Ask user Remote / Local Build
        const buildSource = await vscode.window.showQuickPick(
            [
                { label: 'Remote', description: 'Download build from URL' },
                { label: 'Local', description: 'Use local zip file' }
            ],
            { placeHolder: 'Select build source' }
        );
        if (!buildSource || token.isCancellationRequested) { throw new Error('cancelled'); }

        // Step 4: Get build zip
        let buildZipPath: string | undefined;

        if (buildSource.label === 'Remote') {
            // Read build URL from user
            const downloadUrl = await vscode.window.showInputBox({
                prompt: 'Enter build download URL',
                placeHolder: 'https://...',
                value: selectedService.product.downloadUrl || ''
            });
            if (!downloadUrl || token.isCancellationRequested) { throw new Error('cancelled'); }

            progress.report({ message: 'Downloading build...', increment: 10 });
            buildZipPath = path.join(baseDir, `${projectName.trim()}_build.zip`);
            const wgetUser = settings.wgetUsername;
            const wgetPass = settings.wgetPassword;

            let downloadCmd: string;
            if (wgetUser && wgetPass) {
                downloadCmd = `curl -fL -o "${buildZipPath}" -u "${wgetUser}:${wgetPass}" "${downloadUrl}"`;
            } else {
                downloadCmd = `curl -fL -o "${buildZipPath}" "${downloadUrl}"`;
            }

            const dlResult = await runCommand(downloadCmd);
            if (dlResult.exitCode !== 0) {
                showError(`Build download failed (HTTP error or network issue): ${dlResult.stderr}`);
                throw new Error('cancelled');
            }

            // Validate downloaded file is actually a zip
            if (!fs.existsSync(buildZipPath) || fs.statSync(buildZipPath).size === 0) {
                showError('Build download failed: file is empty or missing');
                throw new Error('cancelled');
            }
            const header = Buffer.alloc(4);
            const fd = fs.openSync(buildZipPath, 'r');
            fs.readSync(fd, header, 0, 4, 0);
            fs.closeSync(fd);
            if (header[0] !== 0x50 || header[1] !== 0x4B) {
                const content = fs.readFileSync(buildZipPath, 'utf-8').substring(0, 200);
                fs.unlinkSync(buildZipPath);
                showError(`Download did not return a valid zip file. Server response: ${content}`);
                throw new Error('cancelled');
            }
        } else {
            // Read the build *.zip file from computer
            const zipUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                filters: { 'Zip files': ['zip'] },
                openLabel: 'Select Build Zip'
            });
            if (!zipUri || zipUri.length === 0) { throw new Error('cancelled'); }
            buildZipPath = zipUri[0].fsPath;
        }

        // Clone repository
        progress.report({ message: 'Cloning repository...', increment: 10 });
        const gitPath = settings.gitPath;
        const repoUrl = selectedService.product.repositoryUrl;

        const branch = await vscode.window.showInputBox({
            prompt: 'Git Branch',
            value: 'master',
            placeHolder: 'e.g. master, development, main'
        });
        if (!branch || token.isCancellationRequested) { throw new Error('cancelled'); }

        const cloneResult = await runCommand(`"${gitPath}" clone -b "${branch}" "${repoUrl}" "${projectDir}"`);
        if (cloneResult.exitCode !== 0) {
            showError(`Git clone failed: ${cloneResult.stderr}`);
            throw new Error('cancelled');
        }

        // Step 8: Create .zide_resources
        progress.report({ message: 'Setting up ZIDE resources...', increment: 5 });
        const zideResourcesDir = path.join(projectDir, '.zide_resources');
        if (!fs.existsSync(zideResourcesDir)) {
            fs.mkdirSync(zideResourcesDir, { recursive: true });
        }

        // Create service.xml (IntelliJ-compatible format: <zide><services><service key><properties>)
        const serviceKey = selectedService.product.serviceName || projectName.trim();
        const deploymentBaseDir = path.join(baseDir, 'deployment', projectName.trim());
        const serviceXmlContent = `<?xml version="1.0" encoding="UTF-8"?><zide><services><service key="${projectName.trim()}"><properties><property name="ZIDE.REPOSITORY_TRUNK" value="${branch}"/><property name="ZIDE.SSH_USERNAME" value="${process.env['USER'] || ''}"/><property name="ZIDE.REPOSITORY_MODULE_DIR" value="${serviceKey}"/><property name="ZIDE.DOWNLOAD_URL" value="${selectedService.product.downloadUrl || ''}"/><property name="ZIDE.LOCAL_DOWNLOAD_URL" value=""/><property name="ZIDE.PARENT_SERVICE" value="${projectName.trim()}"/><property name="ZIDE.DEPLOYMENT_FOLDER" value="${deploymentBaseDir}"/><property name="ZIDE.DEPEND_SERVICES" value=""/><property name="ZIDE.RUNNABLE_SERVICES" value=""/><property name="ZIDE.SUBMODULES" value=""/><property name="ZIDE.SERVICE_KEY" value="${serviceKey.toUpperCase()}"/><property name="ZIDE.COLD_START" value="true"/><property name="ZIDE.DO_REPLACE" value="false"/><property name="ZIDE.PERMISSION" value="1"/><property name="ZIDE.SOURCES" value="src/main/java"/><property name="ZIDE.REPO_TYPE" value="2"/><property name="ZIDE.DEPLOY_TYPE" value="M19"/><property name="ZIDE.MI_DEPLOYMENT" value="false"/><property name="ZIDE.TOMCAT_VERSION" value=""/><property name="ZIDE.PROJECT_JRE_HOME" value=""/></properties></service></services></zide>`;
        fs.writeFileSync(path.join(zideResourcesDir, 'service.xml'), serviceXmlContent, 'utf-8');

        // Create zide_properties.xml (IntelliJ-compatible format, only if not already present)
        const zidePropsFile = path.join(zideResourcesDir, 'zide_properties.xml');
        if (!fs.existsSync(zidePropsFile)) {
            const hostname = this.resolveHostName();
            const userName = process.env['USER'] || '';
            const propsXmlContent = `<?xml version="1.0" encoding="UTF-8"?><zide><services><service key="${serviceKey.toUpperCase()}"><properties><property name="ZIDE.HOST_NAME" value="${hostname}"/><property name="ZIDE.HTTP_PORT" value="8080"/><property name="ZIDE.HTTPS_PORT" value="8443"/><property name="ZIDE.IAM_SERVER" value="https://accounts.csez.zohocorpin.com"/><property name="ZIDE.IAM_SERVICENAME" value="${serviceKey.toUpperCase()}"/><property name="ZIDE.USER_NAME" value="${userName}"/><property name="ZIDE.USER_MAIL" value="${userName}@zohocorp.com"/><property name="ZIDE.MACHINE_IP" value="${hostname}"/><property name="ZIDE_DB_TYPE" value="PGSQL"/><property name="ZIDE_DB_USER" value="root"/><property name="ZIDE_DB_PASS" value=""/><property name="ZIDE_DB_HOST" value="localhost"/><property name="ZIDE_DB_NAME" value=""/><property name="ZIDE.SCHEMA_NAME" value="jbossdb"/></properties></service></services></zide>`;
            fs.writeFileSync(zidePropsFile, propsXmlContent, 'utf-8');
        }

        // Extract build — use IntelliJ-compatible deployment path structure
        progress.report({ message: 'Extracting build...', increment: 10 });
        fs.mkdirSync(deploymentBaseDir, { recursive: true });

        const unzipResult = await runCommand(`unzip -o "${buildZipPath}" -d "${deploymentBaseDir}"`);
        if (unzipResult.exitCode !== 0) {
            showError(`Build extraction failed: ${unzipResult.stderr}`);
            throw new Error('cancelled');
        }

        const tomcatDir = path.join(deploymentBaseDir, 'AdventNet', 'Sas', 'tomcat');
        const webappsDir = fs.existsSync(path.join(tomcatDir, 'webapps'))
            ? path.join(tomcatDir, 'webapps')
            : path.join(deploymentBaseDir, 'webapps');

        progress.report({ message: 'Extracting WAR files...', increment: 10 });
        if (fs.existsSync(webappsDir)) {
            const warFiles = fs.readdirSync(webappsDir).filter(f => f.endsWith('.war'));
            for (const war of warFiles) {
                const warPath = path.join(webappsDir, war);
                const warName = war.replace('.war', '');
                const targetName = warName === 'ROOT' ? selectedService.product.serviceName : warName;
                const warDir = path.join(webappsDir, targetName);
                fs.mkdirSync(warDir, { recursive: true });
                await runCommand(`unzip -o "${warPath}" -d "${warDir}"`);
            }
        }

        // Write repository.properties
        const repoPropsContent = `repositorypath=${projectDir}\n`;
        fs.writeFileSync(path.join(zideResourcesDir, 'repository.properties'), repoPropsContent, 'utf-8');

        // Create zide_build/ and zide_hook/ structures (if not already present from clone)
        progress.report({ message: 'Creating build structures...', increment: 5 });
        this.createZideBuildStructure(projectDir, zideResourcesDir, deploymentBaseDir, selectedService.product.serviceName || projectName.trim(), baseDir);

        // Execute ANT hooks using IntelliJ-compatible structure
        progress.report({ message: 'Running ANT hooks...', increment: 5 });
        const antHome = AntResolver.resolveAntHome();
        if (antHome) {
            const hookProps: Record<string, string> = {
                'REPOSITORY_PATH': projectDir,
                'DEPLOYMENT_PATH': fs.existsSync(tomcatDir) ? tomcatDir : deploymentBaseDir,
                'ZIDE.PARENT_SERVICE': selectedService.product.serviceName
            };

            const zideHookBuildXml = path.join(zideResourcesDir, 'zide_hook', 'build.xml');
            const zideBuildBuildXml = path.join(zideResourcesDir, 'zide_build', 'build.xml');

            if (fs.existsSync(zideHookBuildXml)) {
                const hookBaseDir = path.join(zideResourcesDir, 'zide_hook');
                await AntResolver.runAnt(antHome, zideHookBuildXml, ['clone', '-Dtarget=precreationhook'], {
                    ...hookProps, 'basedir': hookBaseDir
                }, projectDir);
            }
            if (fs.existsSync(zideBuildBuildXml)) {
                const buildBaseDir = path.join(zideResourcesDir, 'zide_build');
                await AntResolver.runAnt(antHome, zideBuildBuildXml, ['clone', '-Dtarget=postcreationhook'], {
                    ...hookProps, 'basedir': buildBaseDir
                }, projectDir);
            }
            if (fs.existsSync(zideHookBuildXml)) {
                const hookBaseDir = path.join(zideResourcesDir, 'zide_hook');
                await AntResolver.runAnt(antHome, zideHookBuildXml, ['clone', '-Dtarget=zidemodulehook'], {
                    ...hookProps, 'basedir': hookBaseDir
                }, projectDir);
            }
        }

        // Clean up downloaded zip if remote
        if (buildSource.label === 'Remote' && buildZipPath && fs.existsSync(buildZipPath)) {
            fs.unlinkSync(buildZipPath);
        }

        return projectDir;
    }

    private static createZideBuildStructure(
        projectDir: string,
        zideResourcesDir: string,
        deploymentDir: string,
        serviceName: string,
        workspaceDir: string
    ): void {
        const zideBuildDir = path.join(zideResourcesDir, 'zide_build');
        const zideHookDir = path.join(zideResourcesDir, 'zide_hook');

        if (fs.existsSync(path.join(zideBuildDir, 'build.xml')) &&
            fs.existsSync(path.join(zideHookDir, 'build.xml'))) {
            return;
        }

        const hgUtilsSource = this.resolveHgUtilsSource(workspaceDir, projectDir);

        if (hgUtilsSource) {
            this.copySharedBuildFiles(hgUtilsSource, zideBuildDir);
            this.copySharedBuildFiles(hgUtilsSource, zideHookDir);
        } else {
            this.generateStubBuildStructure(zideBuildDir, zideHookDir, serviceName, projectDir, deploymentDir);
        }
    }

    private static resolveHgUtilsSource(workspaceDir: string, projectDir: string): string | undefined {
        const antSetupHgUtils = path.join(workspaceDir, '.antsetup', 'hg_utils');
        if (fs.existsSync(path.join(antSetupHgUtils, 'build', 'build.xml'))) {
            return antSetupHgUtils;
        }

        const parent = path.dirname(projectDir);
        if (fs.existsSync(parent)) {
            try {
                const siblings = fs.readdirSync(parent, { withFileTypes: true });
                for (const sibling of siblings) {
                    if (!sibling.isDirectory() || sibling.name === path.basename(projectDir)) { continue; }
                    const siblingHgUtils = path.join(parent, sibling.name, '.zide_resources', 'zide_build', 'hg_utils');
                    if (fs.existsSync(path.join(siblingHgUtils, 'build', 'build.xml'))) {
                        return siblingHgUtils;
                    }
                }
            } catch { /* ignore */ }
        }

        return undefined;
    }

    private static copySharedBuildFiles(source: string, targetDir: string): void {
        fs.mkdirSync(targetDir, { recursive: true });

        const hgUtilsSrc = fs.existsSync(path.join(source, 'hg_utils'))
            ? path.join(source, 'hg_utils')
            : fs.existsSync(path.join(source, 'build', 'build.xml'))
                ? source
                : undefined;

        if (hgUtilsSrc) {
            const hgUtilsDest = path.join(targetDir, 'hg_utils');
            if (!fs.existsSync(hgUtilsDest)) {
                this.copyDirRecursive(hgUtilsSrc, hgUtilsDest);
            }

            const buildXml = path.join(hgUtilsSrc, 'build', 'build.xml');
            if (fs.existsSync(buildXml) && !fs.existsSync(path.join(targetDir, 'build.xml'))) {
                fs.copyFileSync(buildXml, path.join(targetDir, 'build.xml'));
            }
            const libraryXml = path.join(hgUtilsSrc, 'build', 'library.xml');
            if (fs.existsSync(libraryXml) && !fs.existsSync(path.join(targetDir, 'library.xml'))) {
                fs.copyFileSync(libraryXml, path.join(targetDir, 'library.xml'));
            }
            const precheckProps = path.join(hgUtilsSrc, 'build', 'precheck.properties');
            if (fs.existsSync(precheckProps) && !fs.existsSync(path.join(targetDir, 'precheck.properties'))) {
                fs.copyFileSync(precheckProps, path.join(targetDir, 'precheck.properties'));
            }

            const ruleDir = path.join(hgUtilsSrc, 'build', 'rule');
            if (fs.existsSync(ruleDir)) {
                try {
                    const ruleFiles = fs.readdirSync(ruleDir);
                    for (const f of ruleFiles) {
                        const src = path.join(ruleDir, f);
                        if (fs.statSync(src).isFile()) {
                            fs.copyFileSync(src, path.join(targetDir, f));
                        }
                    }
                } catch { /* ignore */ }
            }
        }

        fs.mkdirSync(path.join(targetDir, 'buildlogs'), { recursive: true });
    }

    private static copyDirRecursive(src: string, dest: string): void {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src, { withFileTypes: true });
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                this.copyDirRecursive(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    private static generateStubBuildStructure(
        zideBuildDir: string,
        zideHookDir: string,
        serviceName: string,
        projectDir: string,
        deploymentDir: string
    ): void {
        const deploymentPath = path.join(deploymentDir, 'AdventNet', 'Sas', 'tomcat');

        fs.mkdirSync(zideBuildDir, { recursive: true });
        const buildXmlPath = path.join(zideBuildDir, 'build.xml');
        if (!fs.existsSync(buildXmlPath)) {
            fs.writeFileSync(buildXmlPath, `<?xml version="1.0" encoding="UTF-8"?>
<project name="zide-build-${serviceName}" default="postservicetarget" basedir=".">
    <target name="postservicetarget" description="Post-service deployment target">
        <echo message="Running post-service target for ${serviceName}"/>
        <echo message="Repository: ${projectDir}"/>
        <echo message="Deployment: ${deploymentPath}"/>
    </target>
</project>
`, 'utf-8');
        }
        fs.mkdirSync(path.join(zideBuildDir, 'buildlogs'), { recursive: true });

        fs.mkdirSync(zideHookDir, { recursive: true });
        const hookBuildXmlPath = path.join(zideHookDir, 'build.xml');
        if (!fs.existsSync(hookBuildXmlPath)) {
            fs.writeFileSync(hookBuildXmlPath, `<?xml version="1.0" encoding="UTF-8"?>
<project name="zide-hook-${serviceName}" default="clone" basedir=".">
    <target name="clone" description="Hook dispatcher">
        <echo message="Running hook: \${target} for ${serviceName}"/>
        <antcall target="\${target}"/>
    </target>
    <target name="precreationhook" description="Pre-creation hook">
        <echo message="Pre-creation hook for ${serviceName}"/>
    </target>
    <target name="postcreationhook" description="Post-creation hook">
        <echo message="Post-creation hook for ${serviceName}"/>
    </target>
    <target name="zidemodulehook" description="Zide module hook">
        <echo message="Zide module hook for ${serviceName}"/>
    </target>
</project>
`, 'utf-8');
        }
        fs.mkdirSync(path.join(zideHookDir, 'buildlogs'), { recursive: true });
    }
}
