import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { TomcatServer } from '../model/TomcatServer';
import { StateManager } from '../persistence/StateManager';
import { ZideSetupWizard } from '../zide/ZideSetupWizard';
import { PathResolver } from '../parser/PathResolver';
import { showError, showInfo } from '../util/notificationUtil';

export class AddServerCommand {
    static async run(): Promise<void> {
        const method = await vscode.window.showQuickPick(
            [
                { label: 'Auto-configure from ZIDE', description: 'Use ZIDE configuration files from .zide_resources/', value: 'auto-zide' },
                { label: 'Manual Configuration', description: 'Enter Tomcat settings manually', value: 'manual' }
            ],
            { placeHolder: 'How do you want to add a server?', ignoreFocusOut: true }
        );

        if (!method) { return; }

        if (method.value === 'auto-zide') {
            await this.autoDetect();
        } else {
            await this.manual();
        }
    }

    private static async autoDetect(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showError('No workspace folder open');
            return;
        }

        const projectRoot = workspaceFolder.uri.fsPath;
        const zideResources = PathResolver.resolveZideResourcesPath(projectRoot);
        if (!zideResources) {
            showError('Could not find .zide_resources in workspace');
            return;
        }

        const server = await ZideSetupWizard.run(projectRoot);
        if (server) {
            // Configure Java Pack settings (from old extension)
            await this.configureJavaPackForProject(projectRoot, server);

            // Ensure launch.json configurations (from old extension)
            await this.ensureTomcatLaunchConfigurations(projectRoot);

            showInfo(`Server "${server.name}" added successfully from ZIDE configuration!`);

            // Prompt reload to apply Java tooling updates (from old extension)
            await this.promptReloadDeveloperWindow(
                'ZIDE: Server configured. Reload window to apply Java tooling updates?'
            );
        }
    }

    private static async manual(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Server Name',
            placeHolder: 'e.g., Tomcat 9 Development'
        });
        if (!name) { return; }

        const folderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Tomcat Home Directory',
            title: 'Select Tomcat installation directory'
        });
        if (!folderUri || folderUri.length === 0) { return; }
        const tomcatPath = folderUri[0].fsPath;

        // Validate it's a Tomcat directory
        const catalinaPath = path.join(tomcatPath, 'bin', 'catalina.sh');
        if (!fs.existsSync(catalinaPath)) {
            showError('Invalid Tomcat directory: catalina.sh not found');
            return;
        }

        const portStr = await vscode.window.showInputBox({
            prompt: 'HTTP Port',
            value: '8080',
            validateInput: (v) => {
                const port = parseInt(v);
                if (isNaN(port) || port < 1 || port > 65535) {
                    return 'Please enter a valid port number (1-65535)';
                }
                return undefined;
            }
        });
        if (!portStr) { return; }

        const debugPortStr = await vscode.window.showInputBox({
            prompt: 'Debug Port',
            value: '8787',
            validateInput: (v) => {
                const port = parseInt(v);
                if (isNaN(port) || port < 1 || port > 65535) {
                    return 'Please enter a valid port number (1-65535)';
                }
                return undefined;
            }
        });
        if (!debugPortStr) { return; }

        const description = await vscode.window.showInputBox({
            prompt: 'Server description (optional)',
            placeHolder: 'e.g., Development server for project X'
        });

        const vmArgs = await vscode.window.showInputBox({
            prompt: 'Additional launch VM arguments (optional)',
            placeHolder: 'e.g., -Xmx2g -Dfoo=bar'
        });

        // WAR deployment preference (from old extension)
        const warConfig = await this.promptWarConfiguration();

        const server: TomcatServer = {
            id: crypto.randomUUID(),
            name,
            path: tomcatPath,
            status: 'stopped',
            port: parseInt(portStr, 10),
            debugPort: parseInt(debugPortStr, 10),
            shutdownPort: 9285,
            contextPath: '',
            deploymentDir: '',
            zideResourcesPath: '',
            zidePropertiesPath: '',
            serviceName: name,
            antHome: '',
            javaHome: '',
            vmArguments: vmArgs?.trim() || '',
            description: description || undefined,
            deployConfiguredWarOnRun: warConfig?.deployConfiguredWarOnRun,
            configuredWarFilePath: warConfig?.configuredWarFilePath
        };

        await StateManager.getInstance().addServer(server);
        showInfo(`Server "${name}" added`);

        // Prompt reload
        await this.promptReloadDeveloperWindow(
            'ZIDE: Server configured. Reload window now?'
        );
    }

    // ── WAR Configuration Prompt (from old extension) ────────────────────
    private static async promptWarConfiguration(existingServer?: TomcatServer): Promise<{ deployConfiguredWarOnRun: boolean; configuredWarFilePath?: string } | undefined> {
        const defaultChoice = existingServer?.deployConfiguredWarOnRun ? 'Configure WAR' : 'Skip Deployment';
        const choice = await vscode.window.showQuickPick([
            {
                label: 'Configure WAR',
                detail: 'Select a WAR file now and use it during Run/Debug by default.'
            },
            {
                label: 'Skip Deployment',
                detail: 'Run/Debug will only start or debug the server without deploying a WAR.'
            }
        ], {
            title: 'Deployment Preference',
            placeHolder: `Default: ${defaultChoice}`,
            ignoreFocusOut: true
        });

        if (!choice) { return undefined; }

        if (choice.label === 'Skip Deployment') {
            return { deployConfiguredWarOnRun: false, configuredWarFilePath: undefined };
        }

        const warFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: 'Use This WAR',
            title: 'Select WAR file for Run/Debug',
            filters: { 'WAR Files': ['war'] }
        });

        if (!warFiles || warFiles.length === 0) { return undefined; }

        return {
            deployConfiguredWarOnRun: true,
            configuredWarFilePath: warFiles[0].fsPath
        };
    }

    // ── Java Pack Configuration (from old extension) ─────────────────────
    private static async configureJavaPackForProject(projectPath: string, server: TomcatServer): Promise<void> {
        try {
            await this.configureJavaPackLibraries(projectPath, server);
            await this.configureJavaPackOutputPath(projectPath, server);
            await this.configureJavaPackSourcePaths(projectPath);
            await this.configureJavaPackRuntime(projectPath, server);
        } catch (e) {
            console.error('[ZIDE] Failed to configure Java Pack:', e);
        }
    }

    private static async configureJavaPackLibraries(projectPath: string, server: TomcatServer): Promise<void> {
        const tomcatHome = server.path.replace(/\\/g, '/');
        const parentService = server.zideRuntimeProperties?.['ZIDE.PARENT_SERVICE'] || server.serviceName || 'ROOT';
        const globs = [
            `${tomcatHome}/lib/**/*.jar`,
            `${tomcatHome}/webapps/${parentService}/WEB-INF/lib/**/*.jar`,
            `${tomcatHome}/../lib/**/*.jar`,
            `${tomcatHome}/bin/*.jar`
        ];

        const config = vscode.workspace.getConfiguration('java');
        const existing: string[] = config.get('project.referencedLibraries') ?? [];
        const deduplicated = [...new Set([...existing, ...globs])];

        if (JSON.stringify(existing) !== JSON.stringify(deduplicated)) {
            await config.update('project.referencedLibraries', deduplicated, vscode.ConfigurationTarget.Workspace);
        }
    }

    private static async configureJavaPackOutputPath(projectPath: string, server: TomcatServer): Promise<void> {
        const outputFolder = server.zideRuntimeProperties?.['ZIDE.OUTPUT_FOLDER'];
        const relativePath = outputFolder && !path.isAbsolute(outputFolder) ? outputFolder.replace(/\\/g, '/') : 'bin';

        const config = vscode.workspace.getConfiguration('java', vscode.Uri.file(projectPath));
        const currentOutputPath = config.get<string>('project.outputPath');
        if (currentOutputPath !== relativePath) {
            await config.update('project.outputPath', relativePath, vscode.ConfigurationTarget.Workspace);
        }
    }

    private static async configureJavaPackSourcePaths(projectPath: string): Promise<void> {
        const candidates = ['src', 'source', 'sources', 'java'];
        const existingPaths: string[] = [];
        for (const candidate of candidates) {
            const fullPath = path.join(projectPath, candidate);
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                existingPaths.push(candidate);
            }
        }
        if (existingPaths.length === 0) { return; }

        const config = vscode.workspace.getConfiguration('java', vscode.Uri.file(projectPath));
        const current: string[] = config.get('project.sourcePaths') ?? [];
        const normalized = [...new Set([...current, ...existingPaths])];
        if (JSON.stringify(current) !== JSON.stringify(normalized)) {
            await config.update('project.sourcePaths', normalized, vscode.ConfigurationTarget.Workspace);
        }
    }

    private static async configureJavaPackRuntime(_projectPath: string, server: TomcatServer): Promise<void> {
        const jreHome = server.zideRuntimeProperties?.['ZIDE.PROJECT_JRE_HOME'] || server.javaHome;
        if (!jreHome) { return; }

        const normalizedJreHome = jreHome.replace(/\\/g, '/');
        const config = vscode.workspace.getConfiguration('java');
        const runtimes: Array<{ name: string; path: string; default?: boolean }> = config.get('configuration.runtimes') ?? [];
        const runtimeName = 'JavaSE-17'; // safe default

        const existing = runtimes.find(rt => rt.name === runtimeName);
        if (!existing || existing.path !== normalizedJreHome) {
            const filtered = runtimes.filter(rt => rt.name !== runtimeName);
            filtered.push({ name: runtimeName, path: normalizedJreHome, default: true });
            await config.update('configuration.runtimes', filtered, vscode.ConfigurationTarget.Workspace);
        }
    }

    // ── Launch Configuration (from old extension) ────────────────────────
    private static async ensureTomcatLaunchConfigurations(projectPath: string): Promise<void> {
        const launchFilePath = path.join(projectPath, '.vscode', 'launch.json');
        try {
            const launchDir = path.dirname(launchFilePath);
            if (!fs.existsSync(launchDir)) {
                fs.mkdirSync(launchDir, { recursive: true });
            }

            let launchData: { version: string; configurations: Record<string, unknown>[] } = {
                version: '0.2.0',
                configurations: []
            };

            if (fs.existsSync(launchFilePath)) {
                const raw = fs.readFileSync(launchFilePath, 'utf-8').trim();
                if (raw) {
                    const parsed = JSON.parse(raw);
                    launchData = {
                        version: parsed.version || '0.2.0',
                        configurations: Array.isArray(parsed.configurations) ? parsed.configurations : []
                    };
                }
            }

            const requiredConfigs = [
                {
                    name: 'ZIDE: Run on Server',
                    type: 'java',
                    request: 'launch',
                    mainClass: '',
                    projectName: path.basename(projectPath),
                    preLaunchTask: 'zide.run'
                },
                {
                    name: 'ZIDE: Debug on Server',
                    type: 'java',
                    request: 'attach',
                    hostName: 'localhost',
                    port: 8787,
                    preLaunchTask: 'zide.debug'
                }
            ];

            for (const requiredConfig of requiredConfigs) {
                const existingIndex = launchData.configurations.findIndex(
                    (config: Record<string, unknown>) => config.name === requiredConfig.name
                );
                if (existingIndex >= 0) {
                    launchData.configurations[existingIndex] = {
                        ...launchData.configurations[existingIndex],
                        ...requiredConfig
                    };
                } else {
                    launchData.configurations.push(requiredConfig);
                }
            }

            fs.writeFileSync(launchFilePath, JSON.stringify(launchData, null, 2));
        } catch (error) {
            console.error('[ZIDE] Failed to ensure launch.json configurations:', error);
        }
    }

    // ── Reload Prompt (from old extension) ────────────────────────────────
    private static async promptReloadDeveloperWindow(message: string): Promise<void> {
        const choice = await vscode.window.showInformationMessage(message, 'Reload Window', 'Later');
        if (choice === 'Reload Window') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }
}
