import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StateManager } from '../persistence/StateManager';
import { TomcatManager } from '../tomcat/TomcatManager';
import { PathResolver } from '../parser/PathResolver';
import { ZideConfigParser } from '../parser/ZideConfigParser';
import { showError, showInfo, showConfirm } from '../util/notificationUtil';
import { isPortAvailable, waitForPortRelease } from '../util/portUtil';

export class UninstallProjectCommand {
    static async run(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showError('No workspace folder open');
            return;
        }

        const projectPath = workspaceFolder.uri.fsPath;
        const zideResourcesPath = PathResolver.resolveZideResourcesPath(projectPath);

        const services = zideResourcesPath
            ? ZideConfigParser.parseServiceXml(path.join(zideResourcesPath, 'service.xml'))
            : [];
        const serviceName = services[0]?.name || path.basename(projectPath);

        const confirmed = await showConfirm(
            `Uninstall ZIDE project "${serviceName}"? This will remove server config and deployment folder.`
        );
        if (!confirmed) { return; }

        const deleteProject = await vscode.window.showQuickPick(
            [
                { label: 'Keep project directory', delete: false },
                { label: 'Also delete project directory from disk', delete: true }
            ],
            { placeHolder: 'What to do with the project directory?' }
        );
        if (!deleteProject) { return; }

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `ZIDE: Uninstalling ${serviceName}`, cancellable: false },
            async (progress) => {
                const stateManager = StateManager.getInstance();
                const tomcatManager = TomcatManager.getInstance();

                // Step 1: Stop running server
                progress.report({ message: 'Stopping server...' });
                const mapping = stateManager.getMappingForProject(projectPath);
                let server = mapping ? stateManager.getServer(mapping.serverId) : undefined;

                if (!server) {
                    const servers = stateManager.getServers();
                    server = servers.find(s => s.serviceName === serviceName);
                }

                if (server) {
                    const portInUse = !(await isPortAvailable(server.port));
                    if (portInUse || server.status === 'running') {
                        await tomcatManager.stopServer(server);
                        await waitForPortRelease(server.port, 15000);
                    }

                    // Step 2: Remove server config
                    progress.report({ message: 'Removing server configuration...' });
                    await stateManager.removeServer(server.id);

                    // Step 3: Delete deployment folder
                    progress.report({ message: 'Deleting deployment folder...' });
                    if (server.deploymentDir && fs.existsSync(server.deploymentDir)) {
                        fs.rmSync(server.deploymentDir, { recursive: true, force: true });
                    }
                }

                // Step 4: Remove mapping
                await stateManager.removeMapping(projectPath);

                if (deleteProject.delete) {
                    progress.report({ message: 'Deleting project directory...' });
                    if (fs.existsSync(projectPath)) {
                        fs.rmSync(projectPath, { recursive: true, force: true });
                    }
                    showInfo(`ZIDE project "${serviceName}" uninstalled and project directory deleted.`);
                } else {
                    // Clean up ZIDE metadata only
                    progress.report({ message: 'Cleaning up ZIDE metadata...' });
                    if (zideResourcesPath) {
                        const filesToRemove = ['service.xml', 'zide_properties.xml', 'repository.properties'];
                        for (const fileName of filesToRemove) {
                            const filePath = path.join(zideResourcesPath, fileName);
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }
                        }
                    }
                    showInfo(`ZIDE project "${serviceName}" uninstalled. Server config and deployment removed.`);
                }
            }
        );
    }
}
