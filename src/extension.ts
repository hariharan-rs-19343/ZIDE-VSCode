import * as vscode from 'vscode';
import { StateManager } from './persistence/StateManager';
import { SettingsManager } from './settings/SettingsManager';
import { ServerTreeProvider } from './views/ServerTreeProvider';
import { ServerTreeItem } from './views/ServerTreeItem';
import { TomcatManager } from './tomcat/TomcatManager';
import { DeploySyncListener } from './deploysync/DeploySyncListener';
import { AddServerCommand } from './commands/AddServerCommand';
import { EditServerCommand } from './commands/EditServerCommand';
import { BuildCommand } from './commands/BuildCommand';
import { UpdateDeploymentCommand } from './commands/UpdateDeploymentCommand';
import { DeploymentPropertiesCommand } from './commands/DeploymentPropertiesCommand';
import { ProjectCreator } from './newproject/ProjectCreator';
import { showConfirm, showError } from './util/notificationUtil';

export function activate(context: vscode.ExtensionContext): void {
    // Initialize managers
    const stateManager = StateManager.initialize(context);
    SettingsManager.initialize(context.secrets);
    const tomcatManager = TomcatManager.getInstance();

    // Initialize tree view
    const treeProvider = new ServerTreeProvider();
    const treeView = vscode.window.createTreeView('zide.servers', {
        treeDataProvider: treeProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(treeView);

    // Initialize deploy-sync
    const deploySyncListener = new DeploySyncListener();
    context.subscriptions.push(deploySyncListener);

    // Helper to refresh tree
    const refreshTree = () => treeProvider.refresh();

    // Helper to get server from tree item or pick
    async function resolveServer(item?: ServerTreeItem): Promise<import('./model/TomcatServer').TomcatServer | undefined> {
        if (item) { return item.server; }
        const servers = stateManager.getServers();
        if (servers.length === 0) {
            vscode.window.showInformationMessage('ZIDE: No servers configured');
            return undefined;
        }
        if (servers.length === 1) { return servers[0]; }
        const picked = await vscode.window.showQuickPick(
            servers.map(s => ({ label: s.name, description: `${s.port} - ${s.status}`, server: s })),
            { placeHolder: 'Select a server' }
        );
        return picked?.server;
    }

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('zide.run', async (item?: ServerTreeItem) => {
            const server = await resolveServer(item);
            if (!server) { return; }
            await tomcatManager.startServer(server, 'run');
            refreshTree();
        }),

        vscode.commands.registerCommand('zide.debug', async (item?: ServerTreeItem) => {
            const server = await resolveServer(item);
            if (!server) { return; }
            await tomcatManager.startServer(server, 'debug');
            refreshTree();
        }),

        vscode.commands.registerCommand('zide.stop', async (item?: ServerTreeItem) => {
            const server = await resolveServer(item);
            if (!server) { return; }
            await tomcatManager.stopServer(server);
            refreshTree();
        }),

        vscode.commands.registerCommand('zide.restart', async (item?: ServerTreeItem) => {
            const server = await resolveServer(item);
            if (!server) { return; }
            await tomcatManager.restartServer(server);
            refreshTree();
        }),

        vscode.commands.registerCommand('zide.build', async () => {
            await BuildCommand.run();
        }),

        vscode.commands.registerCommand('zide.addServer', async () => {
            await AddServerCommand.run();
            refreshTree();
        }),

        vscode.commands.registerCommand('zide.editServer', async (item?: ServerTreeItem) => {
            await EditServerCommand.run(item);
            refreshTree();
        }),

        vscode.commands.registerCommand('zide.removeServer', async (item?: ServerTreeItem) => {
            const server = await resolveServer(item);
            if (!server) { return; }
            const confirmed = await showConfirm(`Remove server "${server.name}"?`);
            if (!confirmed) { return; }
            if (server.status === 'running') {
                await tomcatManager.stopServer(server);
            }
            await stateManager.removeServer(server.id);
            refreshTree();
        }),

        vscode.commands.registerCommand('zide.newProject', async () => {
            await ProjectCreator.run();
            refreshTree();
        }),

        vscode.commands.registerCommand('zide.updateDeployment', async () => {
            await UpdateDeploymentCommand.run();
        }),

        vscode.commands.registerCommand('zide.deploymentProperties', async () => {
            await DeploymentPropertiesCommand.run();
        }),

        vscode.commands.registerCommand('zide.appLogs', async (item?: ServerTreeItem) => {
            const server = await resolveServer(item);
            if (!server) { return; }
            await tomcatManager.showAppLogs(server);
        }),

        vscode.commands.registerCommand('zide.customBuild', async () => {
            const settings = SettingsManager.getInstance();
            if (!settings.customBuildUrl) {
                showError('Custom build URL not configured. Set zide.customBuildUrl in settings.');
                return;
            }
            await UpdateDeploymentCommand.run();
        }),

        vscode.commands.registerCommand('zide.localBuild', async () => {
            await UpdateDeploymentCommand.run();
        })
    );

    // Set all servers to stopped on activate (in case of crash)
    const servers = stateManager.getServers();
    for (const server of servers) {
        if (server.status !== 'stopped') {
            stateManager.updateServerStatus(server.id, 'stopped');
        }
    }
    refreshTree();
}

export function deactivate(): void {
    TomcatManager.getInstance().dispose();
}
