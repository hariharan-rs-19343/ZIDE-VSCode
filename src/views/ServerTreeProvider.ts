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
        const servers = StateManager.getInstance().getServers();
        return servers.map(server => new ServerTreeItem(server));
    }
}
