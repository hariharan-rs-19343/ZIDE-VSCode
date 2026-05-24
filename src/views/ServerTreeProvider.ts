import * as vscode from 'vscode';
import { StateManager } from '../persistence/StateManager';
import { ServerTreeItem } from './ServerTreeItem';

export class ServerTreeProvider implements vscode.TreeDataProvider<ServerTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ServerTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ServerTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(_element?: ServerTreeItem): ServerTreeItem[] {
        const projectPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!projectPath) { return []; }

        const stateManager = StateManager.getInstance();
        const mapping = stateManager.getMappingForProject(projectPath);

        if (mapping) {
            const server = stateManager.getServer(mapping.serverId);
            return server ? [new ServerTreeItem(server)] : [];
        }

        return [];
    }
}
