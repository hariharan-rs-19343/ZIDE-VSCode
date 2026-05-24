import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChildProcess, execSync } from 'child_process';
import { TomcatServer } from '../model/TomcatServer';
import { StateManager } from '../persistence/StateManager';
import { isPortAvailable, waitForPort, waitForPortRelease } from '../util/portUtil';
import { spawnShell, findProcessOnPort, killProcess } from '../util/processUtil';
import { buildCatalinaCommand, runScript } from '../util/shellUtil';
import { showInfo, showError, showWarning } from '../util/notificationUtil';
import { DeploymentConfigPatcher } from '../zide/DeploymentConfigPatcher';
import { AntResolver } from '../deploysync/AntResolver';
import { PathResolver } from '../parser/PathResolver';
import { ZideConfigParser } from '../parser/ZideConfigParser';
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

    // ── Server Start ─────────────────────────────────────────────────────
    async startServer(server: TomcatServer, mode: 'run' | 'debug'): Promise<void> {
        const stateManager = StateManager.getInstance();

        if (server.status === 'running') {
            showWarning(`Server "${server.name}" is already running`);
            return;
        }

        // --- Port conflict resolution (new project's improvement) ---
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

        // --- Debug port conflict check (from old extension) ---
        if (mode === 'debug') {
            const debugPortFree = await isPortAvailable(server.debugPort);
            if (!debugPortFree) {
                showError(`Debug port ${server.debugPort} is already in use. Choose another debug port or stop the process using it.`);
                return;
            }
        }

        await stateManager.updateServerStatus(server.id, 'starting');
        await stateManager.updateServerMode(server.id, mode);

        // --- Patch deployment configs ---
        try {
            const patchResults = await DeploymentConfigPatcher.patchAll(server, this.outputChannel);
        } catch (e) {
            showError(`Failed to patch deployment configs: ${e}`);
        }

        // --- Pre-start setup (postzidedeploy.sh + server.xml sync) ---
        await this.runPreStartSetup(server);

        // --- Deploy configured WAR if set (from old extension) ---
        if (server.deployConfiguredWarOnRun && server.configuredWarFilePath) {
            await this.deployWarFile(server, server.configuredWarFilePath, server.contextPath || server.serviceName);
        }

        // --- Run pre-launch hooks (Eclipse: preLaunchCreation) ---
        await this.runPreLaunchHook(server);

        // --- Build CATALINA_OPTS from Zide.properties + substitution ---
        const resolvedVmArgs = this.resolveVmArguments(server);

        // --- Build environment variables ---
        const catalinaPath = path.join(server.path, 'bin', 'catalina.sh');
        const envVars: Record<string, string> = {
            CATALINA_PID: 'pid.file'
        };

        if (resolvedVmArgs) {
            envVars['CATALINA_OPTS'] = resolvedVmArgs;
        }

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
        this.logTimestamped(`======================================`);
        this.logTimestamped(`Starting Tomcat server: ${server.name}`);
        this.logTimestamped(`Script path: ${catalinaPath}`);
        this.logTimestamped(`Port: ${server.port}${mode === 'debug' ? `, Debug port: ${server.debugPort}` : ''}`);
        this.logTimestamped(`======================================`);
        if (resolvedVmArgs) {
            this.logTimestamped(`Applying launch VM arguments for ${server.name}.`);
        }
        this.outputChannel.appendLine(command);
        this.outputChannel.appendLine('');

        const child = spawnShell(command, server.path);
        this.processes.set(server.id, child);

        // --- Stream stdout/stderr in real-time ---
        child.stdout?.on('data', (data: Buffer) => {
            this.outputChannel.append(data.toString());
        });

        child.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            if (!this.isSuppressed(text)) {
                this.outputChannel.append(text);
            }
        });

        // --- Race: wait for port OR process death (new project's improvement) ---
        const processExited = new Promise<number | null>((resolve) => {
            child.on('exit', (code) => {
                resolve(code);
            });
        });

        child.on('exit', async (code) => {
            this.processes.delete(server.id);
            await stateManager.updateServerStatus(server.id, 'stopped');
            this.logTimestamped(`Server process exited with code: ${code}`);
            this.logTimestamped(`Server ${server.name} stopped.`);
        });

        const portReady = waitForPort(server.port, 45000);
        const result = await Promise.race([
            portReady.then(ready => ({ type: 'port' as const, ready })),
            processExited.then(code => ({ type: 'exit' as const, code }))
        ]);

        if (result.type === 'exit') {
            showError(`Server "${server.name}" exited immediately with code ${result.code}. Check the output for errors.`);
            return;
        }

        if (result.ready) {
            // --- For debug mode, also wait for debug port (from old extension) ---
            if (mode === 'debug') {
                const debugPortReady = await waitForPort(server.debugPort, 45000);
                if (!debugPortReady) {
                    showError(`Server started but debug port ${server.debugPort} is not listening. Debug attach may fail.`);
                }
            }

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

    // ── Server Stop ──────────────────────────────────────────────────────
    async stopServer(server: TomcatServer): Promise<void> {
        const stateManager = StateManager.getInstance();

        // --- Check if actually running (from old extension) ---
        const isRunning = !(await isPortAvailable(server.port)) || await this.checkTomcatProcess(server);
        if (!isRunning && server.status === 'stopped') {
            showWarning(`Server "${server.name}" is not running`);
            return;
        }

        await stateManager.updateServerStatus(server.id, 'stopping');

        this.logTimestamped(`======================================`);
        this.logTimestamped(`Stopping server "${server.name}"...`);
        this.logTimestamped(`======================================`);

        // Step 1: SIGTERM the tracked child process
        const child = this.processes.get(server.id);
        if (child && !child.killed) {
            child.kill('SIGTERM');
            this.processes.delete(server.id);
        }

        // Step 2: Wait briefly for graceful exit
        const releasedEarly = await waitForPortRelease(server.port, 5000);
        if (releasedEarly) {
            await stateManager.updateServerStatus(server.id, 'stopped');
            this.logTimestamped(`Server "${server.name}" stopped gracefully.`);
            showInfo(`Server "${server.name}" stopped`);
            return;
        }

        // Step 3: Fallback — catalina.sh stop -force
        const catalinaPath = path.join(server.path, 'bin', 'catalina.sh');
        const envVars: Record<string, string> = {
            CATALINA_PID: path.join(server.path, 'catalina.pid')
        };
        if (server.javaHome) {
            envVars['JAVA_HOME'] = server.javaHome;
        }
        const stopCmd = buildCatalinaCommand(catalinaPath, 'stop -force', envVars);
        this.logTimestamped(`Executing catalina.sh stop -force...`);
        spawnShell(stopCmd, server.path);

        // Wait for catalina stop to take effect
        const releasedAfterStop = await waitForPortRelease(server.port, 8000);
        if (releasedAfterStop) {
            await stateManager.updateServerStatus(server.id, 'stopped');
            this.logTimestamped(`Server "${server.name}" stopped via catalina stop.`);
            showInfo(`Server "${server.name}" stopped`);
            return;
        }

        // Step 4: Last resort — kill process on port directly
        const pid = await findProcessOnPort(server.port);
        if (pid) {
            this.logTimestamped(`Force-killing PID ${pid} on port ${server.port}...`);
            await killProcess(pid);
        }

        await waitForPortRelease(server.port, 3000);
        await stateManager.updateServerStatus(server.id, 'stopped');

        // --- Verify stop (from old extension) ---
        const stillRunning = !(await isPortAvailable(server.port)) || await this.checkTomcatProcess(server);
        if (stillRunning) {
            this.logTimestamped(`Warning: Server may still be running.`);
            showWarning(`Server "${server.name}" may still be running. Check the output for details.`);
        } else {
            this.logTimestamped(`Server "${server.name}" stopped successfully.`);
            showInfo(`Server "${server.name}" stopped`);
        }
    }

    // ── Server Restart ───────────────────────────────────────────────────
    async restartServer(server: TomcatServer, mode?: 'run' | 'debug'): Promise<void> {
        const restartMode = mode ?? server.lastMode ?? 'run';
        await this.stopServer(server);
        await this.startServer(server, restartMode);
    }

    // ── WAR Deployment (from old extension) ──────────────────────────────
    async deployWarFile(server: TomcatServer, warFile: string, contextPath: string): Promise<void> {
        if (!fs.existsSync(warFile)) {
            showWarning(`WAR file not found: ${warFile}`);
            return;
        }

        const webappsDir = path.join(server.path, 'webapps');
        const normalizedContext = this.normalizeContextPath(contextPath);
        const deployedDir = path.join(webappsDir, normalizedContext);
        const targetWarName = normalizedContext === 'ROOT' ? 'ROOT.war' : `${normalizedContext}.war`;
        const targetWarFile = path.join(webappsDir, targetWarName);

        this.logTimestamped(`Deploying ${path.basename(warFile)} as ${targetWarName}...`);

        // Remove existing deployed directory and war
        if (fs.existsSync(deployedDir)) {
            fs.rmSync(deployedDir, { recursive: true, force: true });
        }
        if (fs.existsSync(targetWarFile)) {
            fs.unlinkSync(targetWarFile);
        }

        // Copy WAR file
        fs.copyFileSync(warFile, targetWarFile);
        this.logTimestamped(`Deployment completed: ${targetWarName}`);
    }

    async redeployWar(server: TomcatServer): Promise<void> {
        const warFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectMany: false,
            filters: { 'WAR Files': ['war'] },
            title: 'Select WAR file to deploy'
        });

        if (!warFiles || warFiles.length === 0) { return; }

        const warFile = warFiles[0].fsPath;
        const contextPath = server.contextPath || server.serviceName || 'ROOT';
        await this.deployWarFile(server, warFile, contextPath);
    }

    // ── Run on Server (from old extension) ───────────────────────────────
    async runProjectOnServer(server: TomcatServer, projectPath: string, contextPath: string, warFilePath?: string): Promise<string | undefined> {
        if (warFilePath && fs.existsSync(warFilePath)) {
            await this.deployWarFile(server, warFilePath, contextPath);
        }

        if (server.status !== 'running') {
            await this.startServer(server, 'run');
        }

        return warFilePath;
    }

    // ── Debug on Server (from old extension) ─────────────────────────────
    async debugProjectOnServer(server: TomcatServer, projectPath: string, contextPath: string, warFilePath?: string): Promise<string | undefined> {
        // Check Java debug extension
        const javaExtensionInstalled = vscode.extensions.getExtension('vscjava.vscode-java-pack')
            || vscode.extensions.getExtension('vscjava.vscode-java-debug');

        if (!javaExtensionInstalled) {
            const action = await vscode.window.showWarningMessage(
                'ZIDE: Java extension pack is required for Debug on Server. Install now?',
                'Install', 'Cancel'
            );
            if (action === 'Install') {
                await vscode.commands.executeCommand('workbench.extensions.installExtension', 'vscjava.vscode-java-pack');
            }
            return undefined;
        }

        if (warFilePath && fs.existsSync(warFilePath)) {
            await this.deployWarFile(server, warFilePath, contextPath);
        }

        if (server.status !== 'running') {
            await this.startServer(server, 'debug');
        } else {
            // Server is running — check if debug port is active
            const debugActive = !(await isPortAvailable(server.debugPort));
            if (!debugActive) {
                const restartChoice = await vscode.window.showWarningMessage(
                    `ZIDE: ${server.name} is running without debug enabled. Restart in debug mode?`,
                    'Restart in Debug', 'Cancel'
                );
                if (restartChoice !== 'Restart in Debug') { return undefined; }
                await this.stopServer(server);
                await this.startServer(server, 'debug');
            }
        }

        return warFilePath;
    }

    // ── App Logs ─────────────────────────────────────────────────────────
    async showAppLogs(server: TomcatServer): Promise<void> {
        const logsDir = path.join(server.path, 'logs');

        if (!fs.existsSync(logsDir)) {
            showError('Logs directory not found');
            return;
        }

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

    // ── Refresh All Status ───────────────────────────────────────────────
    async refreshAllServerStatus(): Promise<void> {
        const stateManager = StateManager.getInstance();
        const servers = stateManager.getServers();
        for (const server of servers) {
            const portInUse = !(await isPortAvailable(server.port));
            // Also check Tomcat process (from old extension — more reliable)
            const processAlive = await this.checkTomcatProcess(server);
            const expectedRunning = portInUse || processAlive;

            if (expectedRunning && server.status === 'stopped') {
                await stateManager.updateServerStatus(server.id, 'running');
            } else if (!expectedRunning && server.status !== 'stopped') {
                await stateManager.updateServerStatus(server.id, 'stopped');
            }
        }
    }

    // ── Debugger Attach ──────────────────────────────────────────────────
    private async attachDebugger(server: TomcatServer): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showWarning('No workspace folder open for debug attach');
            return;
        }

        // DO NOT probe the debug port via TCP — JDWP interprets any non-handshake
        // connection as a failed attach and kills the listener.
        // Instead, wait 2 seconds after HTTP port is ready (matching IntelliJ).
        await new Promise(resolve => setTimeout(resolve, 2000));

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

    // ── VM Arguments Resolution ──────────────────────────────────────────

    /**
     * Resolve VM arguments for server launch.
     * Reads `launch.vmarguments` from Zide.properties (deployment/<moduleDir>/M19/Zide.properties),
     * substitutes {PROPERTY_KEY} placeholders with values from zide_properties.xml and service.xml,
     * then appends any user-specified vmArguments as overrides.
     *
     * Also re-reads from file at launch time to pick up changes made since server was configured
     * (improvement from old extension's resolveEffectiveLaunchArgs).
     */
    private resolveVmArguments(server: TomcatServer): string {
        // Re-read launch.vmarguments from Zide.properties at launch time
        // (old extension did this to pick up changes without re-configuring)
        let vmArgs = this.readLaunchVmArguments(server);

        // Update stored value if it changed
        if (vmArgs && vmArgs !== server.zideLaunchVmArguments) {
            const stateManager = StateManager.getInstance();
            server.zideLaunchVmArguments = vmArgs;
            stateManager.updateServer(server); // fire-and-forget
        }

        // Substitute {PROPERTY_KEY} placeholders with zide_properties.xml values
        if (vmArgs) {
            const propsMap = this.getPropertySubstitutionMap(server);
            for (const [key, value] of Object.entries(propsMap)) {
                const placeholder = new RegExp(`\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g');
                vmArgs = vmArgs.replace(placeholder, value);
            }
        }

        // Append JRE 9+ specific args and proxy args
        if (vmArgs) {
            vmArgs = this.appendConditionalVmArgs(server, vmArgs);
        }

        // If user has explicit vmArguments (beyond what Zide.properties provides), append them.
        // Skip if they duplicate the resolved value (fixes pre-existing servers created before this fix).
        if (server.vmArguments
            && server.vmArguments !== server.zideLaunchVmArguments
            && !(vmArgs && vmArgs.includes(server.vmArguments))) {
            vmArgs = vmArgs ? `${vmArgs} ${server.vmArguments}` : server.vmArguments;
        }

        return vmArgs;
    }

    /**
     * Append JRE-version-specific and proxy VM args from Zide.properties.
     */
    private appendConditionalVmArgs(server: TomcatServer, vmArgs: string): string {
        const moduleDir = this.getModuleDir(server);
        if (!moduleDir) { return vmArgs; }

        const projectPath = this.resolveProjectPath(server);
        const workspaceParent = projectPath ? path.dirname(projectPath) : '';
        const candidates = [
            workspaceParent ? path.join(workspaceParent, 'zide', 'deployment', moduleDir, 'M19', 'Zide.properties') : '',
            workspaceParent ? path.join(workspaceParent, 'zide', 'deployment', moduleDir, 'Zide.properties') : ''
        ].filter(Boolean);

        let content = '';
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                content = fs.readFileSync(p, 'utf-8');
                break;
            }
        }
        if (!content) { return vmArgs; }

        // JRE 9+ args
        const jre9Args = this.parseJavaProperty(content, 'launch.jre9plus.vmargs');
        if (jre9Args) {
            for (const arg of jre9Args.split(',').map(a => a.trim()).filter(Boolean)) {
                if (!vmArgs.includes(arg)) {
                    vmArgs += ` ${arg}`;
                }
            }
        }

        // Proxy args
        const proxyArgs = this.parseJavaProperty(content, 'launch.proxy.vmargs');
        if (proxyArgs) {
            for (const arg of proxyArgs.split(/\s+/).filter(Boolean)) {
                if (!vmArgs.includes(arg)) {
                    vmArgs += ` ${arg}`;
                }
            }
        }

        return vmArgs;
    }

    /**
     * Read launch.vmarguments from Zide.properties file.
     */
    private readLaunchVmArguments(server: TomcatServer): string {
        const moduleDir = this.getModuleDir(server);
        if (!moduleDir) { return ''; }

        const projectPath = this.resolveProjectPath(server);
        const workspaceParent = projectPath ? path.dirname(projectPath) : '';

        const candidates = [
            workspaceParent ? path.join(workspaceParent, 'zide', 'deployment', moduleDir, 'M19', 'Zide.properties') : '',
            workspaceParent ? path.join(workspaceParent, 'zide', 'deployment', moduleDir, 'Zide.properties') : '',
            server.zideResourcesPath ? path.join(server.zideResourcesPath, 'deployment', moduleDir, 'M19', 'Zide.properties') : '',
            server.deploymentDir ? path.join(path.dirname(server.deploymentDir), 'zide', 'deployment', moduleDir, 'M19', 'Zide.properties') : '',
            // Also check stored zidePropertiesPath directly (from old extension)
            server.zidePropertiesPath || ''
        ].filter(Boolean);

        for (const propsPath of candidates) {
            if (fs.existsSync(propsPath)) {
                try {
                    const content = fs.readFileSync(propsPath, 'utf-8');
                    return this.parseJavaProperty(content, 'launch.vmarguments');
                } catch { /* continue to next candidate */ }
            }
        }
        return '';
    }

    /**
     * Check if a hook key is enabled (not commented) in Zide.properties.
     */
    private isHookEnabled(server: TomcatServer, hookKey: string): boolean {
        const moduleDir = this.getModuleDir(server);
        if (!moduleDir) { return true; }

        const projectPath = this.resolveProjectPath(server);
        const workspaceParent = projectPath ? path.dirname(projectPath) : '';

        const candidates = [
            workspaceParent ? path.join(workspaceParent, 'zide', 'deployment', moduleDir, 'M19', 'Zide.properties') : '',
            workspaceParent ? path.join(workspaceParent, 'zide', 'deployment', moduleDir, 'Zide.properties') : ''
        ].filter(Boolean);

        for (const propsPath of candidates) {
            if (fs.existsSync(propsPath)) {
                try {
                    const content = fs.readFileSync(propsPath, 'utf-8');
                    const lines = content.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith('#')) {
                            if (trimmed.replace(/^#+\s*/, '').startsWith(hookKey)) {
                                return false;
                            }
                        } else if (trimmed.startsWith(hookKey)) {
                            return true;
                        }
                    }
                    return false;
                } catch { /* continue */ }
            }
        }
        return true;
    }

    /**
     * Get ZIDE.REPOSITORY_MODULE_DIR from service.xml or server config.
     */
    private getModuleDir(server: TomcatServer): string {
        // Prefer stored repositoryModuleDir (from old extension pattern)
        if (server.repositoryModuleDir) {
            return server.repositoryModuleDir;
        }

        if (server.zideResourcesPath) {
            const serviceXmlPath = path.join(server.zideResourcesPath, 'service.xml');
            if (fs.existsSync(serviceXmlPath)) {
                const services = ZideConfigParser.parseServiceXml(serviceXmlPath);
                const parentSvc = services[0];
                if (parentSvc) {
                    return parentSvc.properties['ZIDE.REPOSITORY_MODULE_DIR'] || parentSvc.properties['ZIDE.MODULE_DIR'] || parentSvc.name || server.serviceName;
                }
            }
        }
        return server.serviceName || '';
    }

    /**
     * Resolve the project path from server mappings.
     */
    private resolveProjectPath(server: TomcatServer): string {
        const stateManager = StateManager.getInstance();
        const mappings = stateManager.getMappingsForServer(server.id);
        let projectPath = mappings[0]?.projectPath || '';
        if (!projectPath) {
            projectPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        }
        return projectPath;
    }

    /**
     * Parse a Java .properties key value, handling line continuations (trailing \).
     */
    private parseJavaProperty(content: string, key: string): string {
        const lines = content.split('\n');
        const keyPattern = new RegExp(`^${key.replace(/\./g, '\\.')}\\s*=\\s*`);
        const startIdx = lines.findIndex(l => keyPattern.test(l));
        if (startIdx < 0) { return ''; }

        let combined = lines[startIdx].replace(keyPattern, '');
        let i = startIdx;
        while (combined.endsWith('\\') && i + 1 < lines.length) {
            combined = combined.slice(0, -1) + lines[++i].trimStart();
        }
        return combined.trim();
    }

    /**
     * Build a map of property keys→values for {PLACEHOLDER} substitution in VM args.
     */
    private getPropertySubstitutionMap(server: TomcatServer): Record<string, string> {
        const props: Record<string, string> = {};

        // Include stored runtime properties (from old extension)
        if (server.zideRuntimeProperties) {
            Object.assign(props, server.zideRuntimeProperties);
        }

        // Read from zide_properties.xml
        if (server.zidePropertiesPath && fs.existsSync(server.zidePropertiesPath)) {
            const zideProps = ZideConfigParser.parseZidePropertiesXml(server.zidePropertiesPath);
            Object.assign(props, zideProps);
        }

        // Read from service.xml
        if (server.zideResourcesPath) {
            const serviceXmlPath = path.join(server.zideResourcesPath, 'service.xml');
            if (fs.existsSync(serviceXmlPath)) {
                const services = ZideConfigParser.parseServiceXml(serviceXmlPath);
                const parentSvc = services[0];
                if (parentSvc) {
                    Object.assign(props, parentSvc.properties);
                }
            }
        }

        return props;
    }

    private isSuppressed(text: string): boolean {
        return SUPPRESSED_STDERR_PATTERNS.some(pattern => text.includes(pattern));
    }

    /**
     * Check if a Tomcat process is running for this server (from old extension).
     * More reliable than port check alone — catches zombie processes.
     */
    private async checkTomcatProcess(server: TomcatServer): Promise<boolean> {
        try {
            const stdout = execSync(`ps aux | grep "${server.path}" | grep -v grep`, { encoding: 'utf-8', timeout: 3000 });
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Normalize context path to webapp folder name (from old extension).
     */
    private normalizeContextPath(contextPath: string): string {
        const raw = (contextPath || 'ROOT').trim();
        if (!raw || raw === '/') { return 'ROOT'; }
        const cleaned = raw.replace(/^\/+/, '');
        return cleaned.length > 0 ? cleaned : 'ROOT';
    }

    /**
     * Run pre-launch ANT hook before server start.
     */
    private async runPreLaunchHook(server: TomcatServer): Promise<void> {
        if (!this.isHookEnabled(server, 'hooks.preservicelaunch.all.calltasks')) {
            return;
        }

        const projectPath = this.resolveProjectPath(server);
        if (!projectPath) { return; }

        const repositoryPath = PathResolver.readRepositoryPath(projectPath) ?? projectPath;
        const zideResourcesPath = PathResolver.resolveZideResourcesPath(repositoryPath);
        if (!zideResourcesPath) { return; }

        const hookBuildXml = path.join(zideResourcesPath, 'zide_hook', 'build.xml');
        if (!fs.existsSync(hookBuildXml)) { return; }

        const antHome = AntResolver.resolveAntHome();
        if (!antHome) { return; }

        const serviceXmlPath = path.join(zideResourcesPath, 'service.xml');
        const services = ZideConfigParser.parseServiceXml(serviceXmlPath);
        const parentService = services[0]?.name || path.basename(projectPath);

        const props: Record<string, string> = {
            'basedir': path.join(zideResourcesPath, 'zide_hook'),
            'REPOSITORY_PATH': repositoryPath,
            'DEPLOYMENT_PATH': server.path,
            'ZIDE.PARENT_SERVICE': parentService
        };

        for (const svc of services) {
            const moduleDir = svc.properties['ZIDE.MODULE_DIR'] || svc.name;
            props[`REPOSITORY_PATH.${moduleDir}`] = repositoryPath;
        }

        const propsFile = path.join(zideResourcesPath, 'zide_properties.xml');
        if (fs.existsSync(propsFile)) {
            const zideProps = ZideConfigParser.parseZidePropertiesXml(propsFile);
            for (const [key, value] of Object.entries(zideProps)) {
                if (value) { props[key] = value; }
            }
        }

        this.logTimestamped('Running pre-launch hook...');
        const result = await AntResolver.runAnt(antHome, hookBuildXml, ['clone', '-Dtarget=preservicelaunch'], props, repositoryPath);
        if (result.output) {
            this.outputChannel.appendLine(result.output);
        }
        if (result.success) {
            this.logTimestamped('Pre-launch hook completed.');
        } else {
            this.logTimestamped('Pre-launch hook failed (non-fatal, continuing startup).');
        }
    }

    // ── Pre-Start Setup ──────────────────────────────────────────────────

    /**
     * Run pre-start setup: postzidedeploy.sh + server.xml syncing.
     * Matches IntelliJ IDEA ZIDE plugin behavior.
     */
    private async runPreStartSetup(server: TomcatServer): Promise<void> {
        const projectPath = this.resolveProjectPath(server);
        if (!projectPath) { return; }

        const parentService = this.resolveParentService(server, projectPath);

        this.logTimestamped('--- Pre-start setup ---');

        // Step 1: Run postzidedeploy.sh if it exists
        await this.runPostZideDeploy(server, projectPath, parentService);

        // Step 2: Sync server.xml files
        this.syncServerXml(server, parentService);

        this.logTimestamped('--- Pre-start setup complete ---');
    }

    /**
     * Execute postzidedeploy.sh from <project>/resources/zide-scripts/
     */
    private async runPostZideDeploy(server: TomcatServer, projectPath: string, parentService: string): Promise<void> {
        const scriptPath = path.join(projectPath, 'resources', 'zide-scripts', 'postzidedeploy.sh');
        if (!fs.existsSync(scriptPath)) { return; }

        this.logTimestamped('Running postzidedeploy.sh...');

        // The script uses "../app.properties" as a relative path and
        // SCRIPT_DIR from $1 for the destination. Pass the Sas directory
        // as $1 and run from the script's own directory so relative refs work.
        const scriptDir = path.dirname(scriptPath);
        const sasDir = path.dirname(server.path);

        const env: Record<string, string> = {
            WEBAPP_NAME: parentService
        };

        try {
            const result = await runScript(scriptPath, [sasDir], { cwd: scriptDir, env });
            if (result.stdout) {
                this.outputChannel.appendLine(result.stdout);
            }
            if (result.exitCode !== 0) {
                if (result.stderr) {
                    this.outputChannel.appendLine(result.stderr);
                }
                this.logTimestamped(`postzidedeploy.sh failed with exit code ${result.exitCode}`);
            }
        } catch (e: any) {
            this.logTimestamped(`postzidedeploy.sh failed: ${e.message || e}`);
        }
    }

    /**
     * Sync server.xml between tomcat/conf and webapp WEB-INF/conf.
     * Also checks for Servers/<name>-config/server.xml (Eclipse WTP pattern).
     */
    private syncServerXml(server: TomcatServer, parentService: string): void {
        this.logTimestamped('Syncing server.xml files...');

        const tomcatConfServerXml = path.join(server.path, 'conf', 'server.xml');
        if (!fs.existsSync(tomcatConfServerXml)) {
            this.logTimestamped('  tomcat/conf/server.xml not found, skipping sync.');
            return;
        }

        // Copy tomcat/conf/server.xml → webapps/<name>/WEB-INF/conf/server.xml
        const webappDir = server.deploymentDir
            || path.join(server.path, 'webapps', parentService);
        const webappConfDir = path.join(webappDir, 'WEB-INF', 'conf');

        if (fs.existsSync(webappDir)) {
            if (!fs.existsSync(webappConfDir)) {
                fs.mkdirSync(webappConfDir, { recursive: true });
            }
            const destPath = path.join(webappConfDir, 'server.xml');
            fs.copyFileSync(tomcatConfServerXml, destPath);
            this.logTimestamped(`  Copied tomcat/conf/server.xml → webapps/${parentService}/WEB-INF/conf/server.xml`);
        } else {
            this.logTimestamped(`  webapps/${parentService}/WEB-INF/conf not found, skipping.`);
        }

        // Check for Servers/<name>-config/server.xml (Eclipse WTP pattern)
        const workspaceParent = path.dirname(this.resolveProjectPath(server) || server.path);
        const serversConfigPath = path.join(workspaceParent, 'Servers', `${parentService}-config`, 'server.xml');
        if (fs.existsSync(serversConfigPath)) {
            fs.copyFileSync(serversConfigPath, tomcatConfServerXml);
            this.logTimestamped(`  Copied Servers/${parentService}-config/server.xml → tomcat/conf/server.xml`);
        } else {
            this.logTimestamped(`  Servers/${parentService}-config/server.xml not found, skipping. Tomcat conf server.xml unchanged.`);
        }
    }

    /**
     * Resolve the parent service name (webapp folder name).
     */
    private resolveParentService(server: TomcatServer, projectPath: string): string {
        if (server.zideResourcesPath) {
            const serviceXmlPath = path.join(server.zideResourcesPath, 'service.xml');
            if (fs.existsSync(serviceXmlPath)) {
                const services = ZideConfigParser.parseServiceXml(serviceXmlPath);
                const parentProp = services[0]?.properties['ZIDE.PARENT_SERVICE'];
                if (parentProp) { return parentProp; }
            }
        }
        return server.serviceName || path.basename(projectPath);
    }

    // ── Timestamp Logging ────────────────────────────────────────────────

    private logTimestamped(message: string): void {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        this.outputChannel.appendLine(`[${hh}:${mm}:${ss}] ${message}`);
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
