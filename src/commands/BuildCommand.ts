import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AntResolver } from '../deploysync/AntResolver';
import { showError, showInfo } from '../util/notificationUtil';
import { TomcatManager } from '../tomcat/TomcatManager';
import { spawnShell } from '../util/processUtil';

export class BuildCommand {
    static async run(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showError('No workspace folder open');
            return;
        }

        const projectDir = workspaceFolder.uri.fsPath;
        const buildDir = path.join(projectDir, 'build');

        if (!fs.existsSync(buildDir) || !fs.statSync(buildDir).isDirectory()) {
            showError(`Build directory not found: ${buildDir}`);
            return;
        }

        const antHome = AntResolver.resolveAntHome();
        if (!antHome) {
            showError('ANT not found. Set ANT_HOME environment variable.');
            return;
        }

        const antBin = path.join(antHome, 'bin', 'ant');
        const outputChannel = TomcatManager.getInstance().getOutputChannel();
        outputChannel.clear();
        outputChannel.show(true);
        outputChannel.appendLine(`=== ZIDE Build: ${path.basename(projectDir)} ===`);
        outputChannel.appendLine(`Build dir: ${buildDir}`);
        outputChannel.appendLine(`ANT: ${antBin}\n`);

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'ZIDE: Building...', cancellable: false },
            async () => {
                return new Promise<void>((resolve) => {
                    const child = spawnShell(`"${antBin}"`, buildDir);

                    child.stdout?.on('data', (data: Buffer) => {
                        outputChannel.append(data.toString());
                    });

                    child.stderr?.on('data', (data: Buffer) => {
                        outputChannel.append(data.toString());
                    });

                    child.on('exit', (code) => {
                        if (code === 0) {
                            outputChannel.appendLine('\n=== Build complete ===');
                            showInfo('Build completed successfully');
                        } else {
                            outputChannel.appendLine(`\nBuild FAILED (exit code ${code})`);
                            showError(`ANT build failed with exit code ${code}`);
                        }
                        resolve();
                    });
                });
            }
        );
    }
}
