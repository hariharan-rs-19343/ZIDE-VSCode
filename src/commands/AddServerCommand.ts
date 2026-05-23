import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { TomcatServer } from '../model/TomcatServer';
import { StateManager } from '../persistence/StateManager';
import { ZideSetupWizard } from '../zide/ZideSetupWizard';
import { PathResolver } from '../parser/PathResolver';
import { showError, showInfo } from '../util/notificationUtil';

export class AddServerCommand {
    static async run(): Promise<void> {
        const method = await vscode.window.showQuickPick(
            [
                { label: 'Auto-detect from ZIDE project', description: 'Detect configuration from workspace' },
                { label: 'Manual Configuration', description: 'Enter server details manually' }
            ],
            { placeHolder: 'How do you want to add a server?' }
        );

        if (!method) { return; }

        if (method.label === 'Auto-detect from ZIDE project') {
            await this.autoDetect();
        } else {
            await this.manual();
        }
    }

    private static async autoDetect(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showError('No workspace folder open');
            return;
        }

        const projectRoot = workspaceFolder.uri.fsPath;
        const zideResources = PathResolver.resolveZideResourcesPath(projectRoot);
        if (!zideResources) {
            showError('Could not find .zide_resources in workspace');
            return;
        }

        const server = await ZideSetupWizard.run(projectRoot);
        if (server) {
            showInfo(`Server "${server.name}" added`);
        }
    }

    private static async manual(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Server Name',
            placeHolder: 'My Tomcat Server'
        });
        if (!name) { return; }

        const folderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Tomcat Home Directory'
        });
        if (!folderUri || folderUri.length === 0) { return; }
        const tomcatPath = folderUri[0].fsPath;

        // Validate it's a Tomcat directory
        const catalinaPath = path.join(tomcatPath, 'bin', 'catalina.sh');
        if (!fs.existsSync(catalinaPath)) {
            showError('Invalid Tomcat directory: catalina.sh not found');
            return;
        }

        const portStr = await vscode.window.showInputBox({
            prompt: 'HTTP Port',
            value: '8080',
            validateInput: (v) => /^\d+$/.test(v) ? undefined : 'Must be a number'
        });
        if (!portStr) { return; }

        const debugPortStr = await vscode.window.showInputBox({
            prompt: 'Debug Port',
            value: '8787',
            validateInput: (v) => /^\d+$/.test(v) ? undefined : 'Must be a number'
        });
        if (!debugPortStr) { return; }

        const server: TomcatServer = {
            id: crypto.randomUUID(),
            name,
            path: tomcatPath,
            status: 'stopped',
            port: parseInt(portStr, 10),
            debugPort: parseInt(debugPortStr, 10),
            shutdownPort: 9285,
            contextPath: '',
            deploymentDir: '',
            zideResourcesPath: '',
            zidePropertiesPath: '',
            serviceName: name,
            antHome: '',
            javaHome: '',
            vmArguments: ''
        };

        await StateManager.getInstance().addServer(server);
        showInfo(`Server "${name}" added`);
    }
}
