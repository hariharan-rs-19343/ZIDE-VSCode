import * as vscode from 'vscode';
import * as path from 'path';
import { ChildProcess } from 'child_process';
import { TomcatServer } from '../model/TomcatServer';
import { StateManager } from '../persistence/StateManager';
import { isPortAvailable, waitForPort, waitForPortRelease } from '../util/portUtil';
import { spawnShell, findProcessOnPort, killProcess } from '../util/processUtil';
import { buildCatalinaCommand } from '../util/shellUtil';
import { showInfo, showError, showWarning } from '../util/notificationUtil';
import { DeploymentConfigPatcher } from '../zide/DeploymentConfigPatcher';

const SUPPRESSED_STDERR_PATTERNS = [
    'Picked up _JAVA_OPTIONS',
    'WARNING: An illegal reflective access',
    'WARNING: Please consider reporting',
    'WARNING: Use --illegal-access',
    'WARNING: All illegal access operations',
    'NOTE: Picked up JDK_JAVA_OPTIONS'
];

export class TomcatManager {
    private static instance: TomcatManager;
    private processes: Map<string, ChildProcess> = new Map();
    private outputChannel: vscode.OutputChannel;
    private appLogsChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('ZIDE Output');
        this.appLogsChannel = vscode.window.createOutputChannel('ZIDE App Logs');
    }

    static getInstance(): TomcatManager {
        if (!TomcatManager.instance) {
            TomcatManager.instance = new TomcatManager();
        }
        return TomcatManager.instance;
    }

    getOutputChannel(): vscode.OutputChannel {
        return this.outputChannel;
    }

    getAppLogsChannel(): vscode.OutputChannel {
        return this.appLogsChannel;
    }

    async startServer(server: TomcatServer, mode: 'run' | 'debug'): Promise<void> {
        const stateManager = StateManager.getInstance();

        if (server.status === 'running') {
            showWarning(`Server "${server.name}" is already running`);
            return;
        }

        const portFree = await isPortAvailable(server.port);
        if (!portFree) {
            const pid = await findProcessOnPort(server.port);
            if (pid) {
                showWarning(`Port ${server.port} is in use by PID ${pid}. Attempting to stop...`);
                await killProcess(pid);
                const released = await waitForPortRelease(server.port);
                if (!released) {
                    showError(`Failed to release port ${server.port}`);
                    return;
                }
            } else {
                showError(`Port ${server.port} is in use but could not identify the process`);
                return;
            }
        }

        await stateManager.updateServerStatus(server.id, 'starting');
        await stateManager.updateServerMode(server.id, mode);

        // Patch deployment configs
        try {
            await DeploymentConfigPatcher.patchAll(server);
        } catch (e) {
            showError(`Failed to patch deployment configs: ${e}`);
        }

        // Build environment variables
        const catalinaPath = path.join(server.path, 'bin', 'catalina.sh');
        const envVars: Record<string, string> = {
            CATALINA_PID: path.join(server.path, 'catalina.pid'),
            CATALINA_OPTS: server.vmArguments || ''
        };

        if (server.javaHome) {
            envVars['JAVA_HOME'] = server.javaHome;
        }

        if (mode === 'debug') {
            envVars['JPDA_ADDRESS'] = `*:${server.debugPort}`;
            envVars['JPDA_TRANSPORT'] = 'dt_socket';
        }

        const catalinaMode = mode === 'debug' ? 'jpda run' : 'run';
        const command = buildCatalinaCommand(catalinaPath, catalinaMode, envVars);

        this.outputChannel.show(true);
        this.outputChannel.appendLine(`[ZIDE] Starting server "${server.name}" in ${mode} mode...`);
        this.outputChannel.appendLine(`[ZIDE] Command: ${command}`);
        this.outputChannel.appendLine('');

        const child = spawnShell(command, server.path);
        this.processes.set(server.id, child);

        child.stdout?.on('data', (data: Buffer) => {
            this.outputChannel.append(data.toString());
        });

        child.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            if (!this.isSuppressed(text)) {
                this.outputChannel.append(text);
            }
        });

        child.on('exit', async (code) => {
            this.processes.delete(server.id);
            await stateManager.updateServerStatus(server.id, 'stopped');
            this.outputChannel.appendLine(`\n[ZIDE] Server "${server.name}" exited with code ${code}`);
        });

        // Wait for port to become available
        const ready = await waitForPort(server.port, 45000);
        if (ready) {
            await stateManager.updateServerStatus(server.id, 'running');
            showInfo(`Server "${server.name}" is running on port ${server.port}`);

            if (mode === 'debug') {
                await this.attachDebugger(server);
            }
        } else {
            showError(`Server "${server.name}" failed to start within 45s`);
            await this.stopServer(server);
        }
    }

    async stopServer(server: TomcatServer): Promise<void> {
        const stateManager = StateManager.getInstance();
        await stateManager.updateServerStatus(server.id, 'stopping');

        const child = this.processes.get(server.id);
        if (child && !child.killed) {
            child.kill('SIGTERM');
            this.processes.delete(server.id);
        }

        // Fallback: catalina.sh stop -force
        const catalinaPath = path.join(server.path, 'bin', 'catalina.sh');
        const stopCmd = `sh "${catalinaPath}" stop -force`;
        spawnShell(stopCmd, server.path);

        // Fallback: kill process on port
        const pid = await findProcessOnPort(server.port);
        if (pid) {
            await killProcess(pid);
        }

        await waitForPortRelease(server.port, 3000);
        await stateManager.updateServerStatus(server.id, 'stopped');
        showInfo(`Server "${server.name}" stopped`);
    }

    async restartServer(server: TomcatServer, mode?: 'run' | 'debug'): Promise<void> {
        const restartMode = mode ?? server.lastMode ?? 'run';
        await this.stopServer(server);
        await this.startServer(server, restartMode);
    }

    async showAppLogs(server: TomcatServer): Promise<void> {
        const fs = await import('fs');
        const logsDir = path.join(server.path, 'logs');

        if (!fs.existsSync(logsDir)) {
            showError('Logs directory not found');
            return;
        }

        // Find *application0.txt
        const files = fs.readdirSync(logsDir);
        const logFile = files.find(f => f.includes('application') && f.endsWith('.txt'));
        if (!logFile) {
            showError('No application log file found');
            return;
        }

        const logPath = path.join(logsDir, logFile);
        const content = fs.readFileSync(logPath, 'utf-8');
        const lines = content.split('\n');
        const last5000 = lines.slice(-5000).join('\n');

        this.appLogsChannel.clear();
        this.appLogsChannel.append(last5000);
        this.appLogsChannel.show(true);
    }

    async refreshAllServerStatus(): Promise<void> {
        const stateManager = StateManager.getInstance();
        const servers = stateManager.getServers();
        for (const server of servers) {
            const portInUse = !(await isPortAvailable(server.port));
            const expectedRunning = portInUse;
            if (expectedRunning && server.status === 'stopped') {
                await stateManager.updateServerStatus(server.id, 'running');
            } else if (!expectedRunning && server.status !== 'stopped') {
                await stateManager.updateServerStatus(server.id, 'stopped');
            }
        }
    }

    private async attachDebugger(server: TomcatServer): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showWarning('No workspace folder open for debug attach');
            return;
        }

        const debugConfig: vscode.DebugConfiguration = {
            type: 'java',
            name: `ZIDE Debug - ${server.name}`,
            request: 'attach',
            hostName: 'localhost',
            port: server.debugPort
        };

        const started = await vscode.debug.startDebugging(workspaceFolder, debugConfig);
        if (started) {
            showInfo(`Debugger attached on port ${server.debugPort}`);
        } else {
            showWarning('Failed to attach debugger. Is the Java Debug extension installed?');
        }
    }

    private isSuppressed(text: string): boolean {
        return SUPPRESSED_STDERR_PATTERNS.some(pattern => text.includes(pattern));
    }

    dispose(): void {
        for (const [id, child] of this.processes) {
            if (!child.killed) {
                child.kill('SIGTERM');
            }
            this.processes.delete(id);
        }
        this.outputChannel.dispose();
        this.appLogsChannel.dispose();
    }
}
