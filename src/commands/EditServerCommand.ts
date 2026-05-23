import * as vscode from 'vscode';
import { TomcatServer } from '../model/TomcatServer';
import { StateManager } from '../persistence/StateManager';
import { ServerTreeItem } from '../views/ServerTreeItem';
import { showInfo } from '../util/notificationUtil';

export class EditServerCommand {
    static async run(item?: ServerTreeItem): Promise<void> {
        const stateManager = StateManager.getInstance();
        let server: TomcatServer | undefined;

        if (item) {
            server = item.server;
        } else {
            // Pick from list
            const servers = stateManager.getServers();
            if (servers.length === 0) {
                vscode.window.showInformationMessage('ZIDE: No servers configured');
                return;
            }
            const picked = await vscode.window.showQuickPick(
                servers.map(s => ({ label: s.name, description: `Port: ${s.port}`, server: s })),
                { placeHolder: 'Select server to edit' }
            );
            if (!picked) { return; }
            server = picked.server;
        }

        if (!server) { return; }

        const name = await vscode.window.showInputBox({
            prompt: 'Server Name',
            value: server.name
        });
        if (name === undefined) { return; }

        const portStr = await vscode.window.showInputBox({
            prompt: 'HTTP Port',
            value: String(server.port),
            validateInput: (v) => /^\d+$/.test(v) ? undefined : 'Must be a number'
        });
        if (portStr === undefined) { return; }

        const debugPortStr = await vscode.window.showInputBox({
            prompt: 'Debug Port',
            value: String(server.debugPort),
            validateInput: (v) => /^\d+$/.test(v) ? undefined : 'Must be a number'
        });
        if (debugPortStr === undefined) { return; }

        const vmArgs = await vscode.window.showInputBox({
            prompt: 'VM Arguments (optional)',
            value: server.vmArguments
        });
        if (vmArgs === undefined) { return; }

        server.name = name;
        server.port = parseInt(portStr, 10);
        server.debugPort = parseInt(debugPortStr, 10);
        server.vmArguments = vmArgs;

        await stateManager.updateServer(server);
        showInfo(`Server "${name}" updated`);
    }
}
