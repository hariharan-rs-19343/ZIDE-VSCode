import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StateManager } from '../persistence/StateManager';
import { AntResolver } from '../deploysync/AntResolver';
import { showError, showInfo } from '../util/notificationUtil';
import { TomcatManager } from '../tomcat/TomcatManager';

export class BuildCommand {
    static async run(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showError('No workspace folder open');
            return;
        }

        const projectDir = workspaceFolder.uri.fsPath;
        const mapping = StateManager.getInstance().getMappingForProject(projectDir);
        let antHome: string | undefined;
        let buildFile: string | undefined;

        if (mapping) {
            const server = StateManager.getInstance().getServer(mapping.serverId);
            if (server) {
                antHome = AntResolver.resolveAntHome(server.antHome);
            }
        }

        if (!antHome) {
            antHome = AntResolver.resolveAntHome();
        }

        if (!antHome) {
            showError('ANT_HOME not found. Set ANT_HOME environment variable or configure in server settings.');
            return;
        }

        // Find build file
        const candidates = [
            path.join(projectDir, 'zide_build.xml'),
            path.join(projectDir, 'build.xml')
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                buildFile = candidate;
                break;
            }
        }

        if (!buildFile) {
            const fileUri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                filters: { 'XML files': ['xml'] },
                openLabel: 'Select Build File'
            });
            if (!fileUri || fileUri.length === 0) { return; }
            buildFile = fileUri[0].fsPath;
        }

        const outputChannel = TomcatManager.getInstance().getOutputChannel();
        outputChannel.show(true);
        outputChannel.appendLine(`[ZIDE] Running build: ${buildFile}`);

        const properties: Record<string, string> = { 'project.dir': projectDir };
        if (mapping) {
            const server = StateManager.getInstance().getServer(mapping.serverId);
            if (server?.deploymentDir) {
                properties['deployment.dir'] = server.deploymentDir;
            }
        }

        const result = await AntResolver.runAnt(antHome, buildFile, ['default'], properties, projectDir);

        outputChannel.appendLine(result.output);
        if (result.success) {
            outputChannel.appendLine('[ZIDE] Build successful');
            showInfo('Build completed successfully');
        } else {
            outputChannel.appendLine('[ZIDE] Build failed');
            showError('Build failed. Check ZIDE Output for details.');
        }
    }
}
