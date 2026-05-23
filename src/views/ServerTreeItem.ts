import * as vscode from 'vscode';
import { TomcatServer } from '../model/TomcatServer';

export class ServerTreeItem extends vscode.TreeItem {
    constructor(public readonly server: TomcatServer) {
        super(server.name, vscode.TreeItemCollapsibleState.None);

        const isRunning = server.status === 'running';
        const isStarting = server.status === 'starting';
        const isStopping = server.status === 'stopping';

        this.description = `${server.port} - ${server.status}`;
        this.tooltip = `${server.name}\nPath: ${server.path}\nPort: ${server.port}\nDebug Port: ${server.debugPort}\nStatus: ${server.status}`;

        if (isRunning) {
            this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
            this.contextValue = 'serverRunning';
        } else if (isStarting || isStopping) {
            this.iconPath = new vscode.ThemeIcon('loading~spin');
            this.contextValue = 'serverTransitioning';
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
            this.contextValue = 'serverStopped';
        }
    }
}
