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
import { showConfirm } from './util/notificationUtil';
import { RunHooksCommand } from './commands/RunHooksCommand';
import { UninstallProjectCommand } from './commands/UninstallProjectCommand';
import { UpdateChecker } from './update/UpdateChecker';
import { SettingsWebviewProvider } from './views/SettingsWebviewProvider';

export function activate(context: vscode.ExtensionContext): void {
    // Initialize managers
    const stateManager = StateManager.initialize(context);
    SettingsManager.initialize(context);
    const tomcatManager = TomcatManager.getInstance();
    const settingsWebview = new SettingsWebviewProvider(context);

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

        // WAR redeploy command (from old extension)
        vscode.commands.registerCommand('zide.redeployServer', async (item?: ServerTreeItem) => {
            const server = await resolveServer(item);
            if (!server) { return; }
            await tomcatManager.redeployWar(server);
        }),

        vscode.commands.registerCommand('zide.customBuild', async () => {
            await UpdateDeploymentCommand.runCustomBuild();
        }),

        vscode.commands.registerCommand('zide.localBuild', async () => {
            await UpdateDeploymentCommand.runLocalBuild();
        }),

        vscode.commands.registerCommand('zide.runHooks', async () => {
            await RunHooksCommand.pickAndRun();
        }),

        vscode.commands.registerCommand('zide.runAllHooks', async () => {
            await RunHooksCommand.runAll();
        }),

        vscode.commands.registerCommand('zide.runPrecreationHook', async () => {
            await RunHooksCommand.runPrecreation();
        }),

        vscode.commands.registerCommand('zide.runPostcreationHook', async () => {
            await RunHooksCommand.runPostcreation();
        }),

        vscode.commands.registerCommand('zide.runZideModuleHook', async () => {
            await RunHooksCommand.runZideModule();
        }),

        vscode.commands.registerCommand('zide.uninstallProject', async () => {
            await UninstallProjectCommand.run();
            refreshTree();
        }),

        vscode.commands.registerCommand('zide.refreshServers', async () => {
            await tomcatManager.refreshAllServerStatus();
            refreshTree();
        }),

        vscode.commands.registerCommand('zide.refreshAppLogs', async (item?: ServerTreeItem) => {
            const server = await resolveServer(item);
            if (!server) { return; }
            await tomcatManager.showAppLogs(server);
        }),

        vscode.commands.registerCommand('zide.checkForUpdate', async () => {
            await UpdateChecker.checkManually(context);
        }),

        vscode.commands.registerCommand('zide.openSettings', async () => {
            await settingsWebview.show();
        }),

        vscode.commands.registerCommand('zide.detectGitPath', async () => {
            try {
                const { execSync } = require('child_process');
                const gitPath = execSync('which git', { encoding: 'utf-8' }).trim();
                await context.globalState.update('zide.setting.gitPath', gitPath);
                vscode.window.showInformationMessage(`Git path detected: ${gitPath}`);
            } catch {
                vscode.window.showErrorMessage('Could not detect git. Please install git or set the path manually.');
            }
        })
    );

    // Probe actual server status via port checks instead of blindly resetting
    tomcatManager.refreshAllServerStatus().then(() => refreshTree());

    // Check for ~/.wgetrc
    const fs = require('fs');
    const wgetrcPath = require('path').join(process.env['HOME'] || '', '.wgetrc');
    if (!fs.existsSync(wgetrcPath)) {
        vscode.window.showWarningMessage(
            'ZIDE: ~/.wgetrc file is missing. Configure Wget credentials in Settings > ZIDE.'
        );
    }

    // Background update check
    UpdateChecker.checkOnActivation(context);
}

export function deactivate(): void {
    TomcatManager.getInstance().dispose();
}
