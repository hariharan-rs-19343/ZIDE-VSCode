import * as vscode from 'vscode';
import { ResourceSyncManager } from './ResourceSyncManager';

export class DeploySyncListener {
    private disposable: vscode.Disposable;

    constructor() {
        this.disposable = vscode.workspace.onDidSaveTextDocument((document) => {
            ResourceSyncManager.syncFile(document);
        });
    }

    dispose(): void {
        this.disposable.dispose();
    }
}
