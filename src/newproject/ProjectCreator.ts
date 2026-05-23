import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CmToolApiClient, CmToolProduct } from './CmToolApiClient';
import { SettingsManager } from '../settings/SettingsManager';
import { ZideSetupWizard } from '../zide/ZideSetupWizard';
import { DeploymentConfigPatcher } from '../zide/DeploymentConfigPatcher';
import { AntResolver } from '../deploysync/AntResolver';
import { runCommand } from '../util/processUtil';
import { showError } from '../util/notificationUtil';

export class ProjectCreator {
    static async run(): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'ZIDE: Creating New Project',
                cancellable: true
            },
            async (progress, token) => {
                try {
                    await this.createProject(progress, token);
                } catch (e) {
                    if (e instanceof Error && e.message === 'cancelled') { return; }
                    showError(`Project creation failed: ${e}`);
                }
            }
        );
    }

    private static async createProject(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): Promise<void> {
        const settings = SettingsManager.getInstance();

        // Step 1: Validate CMTool auth token
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

        // Step 2: Fetch services
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

        // Step 3: Select service
        progress.report({ message: 'Select service...', increment: 5 });
        const selectedService = await vscode.window.showQuickPick(
            services.map(s => ({ label: s.name, description: s.serviceName, product: s })),
            { placeHolder: 'Select a service to create project from' }
        );
        if (!selectedService || token.isCancellationRequested) { throw new Error('cancelled'); }

        // Step 4: Select branch
        const branch = await vscode.window.showInputBox({
            prompt: 'Branch name',
            value: 'master',
            placeHolder: 'master'
        });
        if (!branch || token.isCancellationRequested) { throw new Error('cancelled'); }

        // Step 5: Build source
        const buildSource = await vscode.window.showQuickPick(
            [
                { label: 'Remote', description: 'Download build from server' },
                { label: 'Local', description: 'Use local zip file' }
            ],
            { placeHolder: 'Select build source' }
        );
        if (!buildSource || token.isCancellationRequested) { throw new Error('cancelled'); }

        // Step 6: Project location
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Project Location'
        });
        if (!folderUri || folderUri.length === 0 || token.isCancellationRequested) { throw new Error('cancelled'); }

        const projectDir = path.join(folderUri[0].fsPath, selectedService.product.serviceName);

        // Step 7: Git clone
        progress.report({ message: 'Cloning repository...', increment: 10 });
        const gitPath = settings.gitPath;
        const repoUrl = selectedService.product.repositoryUrl;
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

        // Create minimal service.xml
        const serviceXmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<services>
    <service name="${selectedService.product.serviceName}">
        <property name="http.port" value="8080"/>
        <property name="debug.port" value="8787"/>
        <property name="shutdown.port" value="9285"/>
        <property name="context.path" value="/${selectedService.product.serviceName}"/>
    </service>
</services>`;
        fs.writeFileSync(path.join(zideResourcesDir, 'service.xml'), serviceXmlContent, 'utf-8');

        // Create minimal zide_properties.xml
        const propsXmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<properties>
    <property name="service.name" value="${selectedService.product.serviceName}"/>
</properties>`;
        fs.writeFileSync(path.join(zideResourcesDir, 'zide_properties.xml'), propsXmlContent, 'utf-8');

        // Step 9 & 10: Download/extract build
        progress.report({ message: 'Preparing build...', increment: 10 });
        let buildZipPath: string | undefined;

        if (buildSource.label === 'Remote') {
            const downloadUrl = selectedService.product.downloadUrl || settings.customBuildUrl;
            if (!downloadUrl) {
                showError('No download URL available');
                throw new Error('cancelled');
            }

            buildZipPath = path.join(projectDir, 'build.zip');
            const wgetUser = settings.wgetUsername;
            const wgetPass = await settings.getWgetPassword();

            let downloadCmd: string;
            if (wgetUser && wgetPass) {
                downloadCmd = `curl -L -o "${buildZipPath}" -u "${wgetUser}:${wgetPass}" "${downloadUrl}"`;
            } else {
                downloadCmd = `curl -L -o "${buildZipPath}" "${downloadUrl}"`;
            }

            const dlResult = await runCommand(downloadCmd);
            if (dlResult.exitCode !== 0) {
                showError(`Build download failed: ${dlResult.stderr}`);
                throw new Error('cancelled');
            }
        } else {
            const zipUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                filters: { 'Zip files': ['zip'] },
                openLabel: 'Select Build Zip'
            });
            if (!zipUri || zipUri.length === 0) { throw new Error('cancelled'); }
            buildZipPath = zipUri[0].fsPath;
        }

        // Step 10: Extract build
        progress.report({ message: 'Extracting build...', increment: 10 });
        const deploymentDir = path.join(projectDir, 'deployment');
        fs.mkdirSync(deploymentDir, { recursive: true });

        const unzipResult = await runCommand(`unzip -o "${buildZipPath}" -d "${deploymentDir}"`);
        if (unzipResult.exitCode !== 0) {
            showError(`Build extraction failed: ${unzipResult.stderr}`);
            throw new Error('cancelled');
        }

        // Step 11: Extract WAR files
        progress.report({ message: 'Extracting WAR files...', increment: 10 });
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

        // Step 12: Copy/generate ANT scripts
        progress.report({ message: 'Setting up ANT scripts...', increment: 5 });

        // Step 13: Execute ANT hooks
        progress.report({ message: 'Running ANT hooks...', increment: 10 });
        const antHome = AntResolver.resolveAntHome();
        if (antHome) {
            const hookFiles = ['precreation.xml', 'postcreation.xml', 'zidemodule.xml'];
            for (const hookFile of hookFiles) {
                const hookPath = path.join(zideResourcesDir, hookFile);
                if (fs.existsSync(hookPath)) {
                    await AntResolver.runAnt(antHome, hookPath, ['default'], {
                        'project.dir': projectDir,
                        'deployment.dir': deploymentDir
                    }, projectDir);
                }
            }
        }

        // Step 14-16: Configure server
        progress.report({ message: 'Configuring server...', increment: 10 });
        const server = await ZideSetupWizard.run(projectDir);
        if (server) {
            server.deploymentDir = deploymentDir;
            await DeploymentConfigPatcher.patchAll(server);
        }

        // Step 17: Open folder
        progress.report({ message: 'Opening project...', increment: 5 });

        // Clean up downloaded zip if remote
        if (buildSource.label === 'Remote' && buildZipPath && fs.existsSync(buildZipPath)) {
            fs.unlinkSync(buildZipPath);
        }

        const openFolder = await vscode.window.showInformationMessage(
            `Project "${selectedService.product.serviceName}" created successfully!`,
            'Open Folder'
        );
        if (openFolder === 'Open Folder') {
            vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectDir));
        }
    }
}
