import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SettingsManager } from '../settings/SettingsManager';
import { DeploymentConfigPatcher } from '../zide/DeploymentConfigPatcher';
import { AntResolver } from '../deploysync/AntResolver';
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

        // Find project root
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showError('No workspace folder open');
            return;
        }
        const projectDir = workspaceFolder.uri.fsPath;

        // Find server mapping
        const mapping = StateManager.getInstance().getMappingForProject(projectDir);
        if (!mapping) {
            showError('No server configured for this project');
            return;
        }
        const server = StateManager.getInstance().getServer(mapping.serverId);
        if (!server) {
            showError('Server not found');
            return;
        }

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'ZIDE: Updating Deployment', cancellable: true },
            async (progress, token) => {
                let buildZipPath: string | undefined;

                if (buildSource.label.startsWith('Custom')) {
                    // Remote download
                    const settings = SettingsManager.getInstance();
                    const url = settings.customBuildUrl || await vscode.window.showInputBox({
                        prompt: 'Enter build download URL'
                    });
                    if (!url || token.isCancellationRequested) { return; }

                    progress.report({ message: 'Downloading build...' });
                    buildZipPath = path.join(projectDir, 'build_update.zip');

                    const wgetUser = settings.wgetUsername;
                    const wgetPass = await settings.getWgetPassword();

                    let downloadCmd: string;
                    if (wgetUser && wgetPass) {
                        downloadCmd = `curl -L -o "${buildZipPath}" -u "${wgetUser}:${wgetPass}" "${url}"`;
                    } else {
                        downloadCmd = `curl -L -o "${buildZipPath}" "${url}"`;
                    }

                    const dlResult = await runCommand(downloadCmd);
                    if (dlResult.exitCode !== 0) {
                        showError(`Download failed: ${dlResult.stderr}`);
                        return;
                    }
                } else {
                    // Local zip
                    const zipUri = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        filters: { 'Zip files': ['zip'] },
                        openLabel: 'Select Build Zip'
                    });
                    if (!zipUri || zipUri.length === 0) { return; }
                    buildZipPath = zipUri[0].fsPath;
                }

                // Extract
                progress.report({ message: 'Extracting build...' });
                const deploymentDir = server.deploymentDir;
                if (!deploymentDir) {
                    showError('No deployment directory configured');
                    return;
                }

                const unzipResult = await runCommand(`unzip -o "${buildZipPath}" -d "${deploymentDir}"`);
                if (unzipResult.exitCode !== 0) {
                    showError(`Extraction failed: ${unzipResult.stderr}`);
                    return;
                }

                // Extract WARs
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

                // Run ANT hooks
                progress.report({ message: 'Running ANT hooks...' });
                const antHome = AntResolver.resolveAntHome(server.antHome);
                if (antHome) {
                    const zideResources = server.zideResourcesPath;
                    const hookFile = path.join(zideResources, 'postzidedeploy.xml');
                    if (fs.existsSync(hookFile)) {
                        await AntResolver.runAnt(antHome, hookFile, ['default'], {
                            'project.dir': projectDir,
                            'deployment.dir': deploymentDir
                        }, projectDir);
                    }
                }

                // Patch configs
                progress.report({ message: 'Patching configurations...' });
                await DeploymentConfigPatcher.patchAll(server);

                // Cleanup
                if (buildSource.label.startsWith('Custom') && buildZipPath && fs.existsSync(buildZipPath)) {
                    fs.unlinkSync(buildZipPath);
                }

                showInfo('Deployment updated successfully');
            }
        );
    }
}
