import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StateManager } from '../persistence/StateManager';
import { AntResolver } from '../deploysync/AntResolver';
import { PathResolver } from '../parser/PathResolver';
import { ZideConfigParser } from '../parser/ZideConfigParser';
import { TomcatManager } from '../tomcat/TomcatManager';
import { showError, showInfo } from '../util/notificationUtil';

interface HookDef {
    target: string;
    hookName: string;
    useZideHookDir: boolean;
    label: string;
}

const PRECREATION: HookDef = { target: 'precreationhook', hookName: 'precreation', useZideHookDir: true, label: 'Precreation Hook' };
const POSTCREATION: HookDef = { target: 'postcreationhook', hookName: 'postcreation', useZideHookDir: false, label: 'Postcreation Hook' };
const ZIDEMODULE: HookDef = { target: 'zidemodulehook', hookName: 'zideoperations', useZideHookDir: true, label: 'ZideModule Hook' };

const REQUIRED_PROPERTIES: Record<string, () => string> = {
    'ZIDE.HOST_NAME': () => resolveHostName(),
    'ZIDE.USER_MAIL': () => `${process.env['USER'] || ''}@zohocorp.com`,
    'ZIDE.IAM_SERVER': () => 'https://accounts.csez.zohocorpin.com',
    'ZIDE.HTTP_PORT': () => '8080',
    'ZIDE.HTTPS_PORT': () => '8443',
    'ZIDE.IAM_SERVICENAME': () => '',
    'ZIDE.USER_NAME': () => process.env['USER'] || '',
    'ZIDE.MACHINE_IP': () => resolveHostName(),
    'ZIDE_DB_TYPE': () => 'PGSQL',
    'ZIDE_DB_HOST': () => 'localhost',
    'ZIDE_DB_USER': () => 'root',
    'ZIDE_DB_PASS': () => '',
    'ZIDE_DB_NAME': () => '',
    'ZIDE.SCHEMA_NAME': () => 'jbossdb'
};

function resolveHostName(): string {
    const csezDomain = '.csez.zohocorpin.com';
    try {
        const { execSync } = require('child_process');
        const hostname = execSync('hostname', { encoding: 'utf-8' }).trim();
        return hostname.endsWith(csezDomain) ? hostname : `${hostname}${csezDomain}`;
    } catch {
        return `localhost${csezDomain}`;
    }
}

export class RunHooksCommand {
    static async runAll(): Promise<void> {
        await this.runHooks([PRECREATION, POSTCREATION, ZIDEMODULE], 'Run All Hooks');
    }

    static async runPrecreation(): Promise<void> {
        await this.runHooks([PRECREATION], 'Run Precreation Hook');
    }

    static async runPostcreation(): Promise<void> {
        await this.runHooks([POSTCREATION], 'Run Postcreation Hook');
    }

    static async runZideModule(): Promise<void> {
        await this.runHooks([ZIDEMODULE], 'Run ZideModule Hook');
    }

    static async pickAndRun(): Promise<void> {
        const picks = [
            { label: 'Run All Hooks', hooks: [PRECREATION, POSTCREATION, ZIDEMODULE] },
            { label: PRECREATION.label, hooks: [PRECREATION] },
            { label: POSTCREATION.label, hooks: [POSTCREATION] },
            { label: ZIDEMODULE.label, hooks: [ZIDEMODULE] }
        ];

        const selected = await vscode.window.showQuickPick(picks, { placeHolder: 'Select hook to run' });
        if (!selected) { return; }

        await this.runHooks(selected.hooks, selected.label);
    }

    private static async runHooks(hooks: HookDef[], taskTitle: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showError('No workspace folder open');
            return;
        }

        const projectPath = workspaceFolder.uri.fsPath;
        const repositoryPath = PathResolver.readRepositoryPath(projectPath) ?? projectPath;

        const antHome = AntResolver.resolveAntHome();
        if (!antHome) {
            showError('ANT_HOME not found. Configure ANT in your environment.');
            return;
        }

        const zideResourcesPath = PathResolver.resolveZideResourcesPath(repositoryPath);
        if (!zideResourcesPath) {
            showError('Could not find .zide_resources directory');
            return;
        }

        let deploymentPath = '';
        const mapping = StateManager.getInstance().getMappingForProject(projectPath);
        if (mapping) {
            const server = StateManager.getInstance().getServer(mapping.serverId);
            if (server) { deploymentPath = server.path; }
        }

        const services = ZideConfigParser.parseServiceXml(path.join(zideResourcesPath, 'service.xml'));
        const parentService = services[0]?.name || path.basename(projectPath);

        const outputChannel = TomcatManager.getInstance().getOutputChannel();
        outputChannel.show(true);

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `ZIDE: ${taskTitle}`, cancellable: false },
            async (progress) => {
                outputChannel.appendLine(`\n=== ${taskTitle} ===`);

                progress.report({ message: 'Validating properties...' });
                this.ensureRequiredProperties(zideResourcesPath, parentService, outputChannel);

                for (let i = 0; i < hooks.length; i++) {
                    const hook = hooks[i];
                    progress.report({ message: `Running ${hook.label}...` });

                    const baseDir = hook.useZideHookDir
                        ? path.join(repositoryPath, '.zide_resources', 'zide_hook')
                        : path.join(repositoryPath, '.zide_resources', 'zide_build');
                    const buildXml = path.join(baseDir, 'build.xml');

                    if (!fs.existsSync(buildXml)) {
                        outputChannel.appendLine(`  Skipping ${hook.label}: ${buildXml} not found.`);
                        continue;
                    }

                    outputChannel.appendLine(`\n--- ${hook.label} (${hook.target}) ---`);

                    const result = await AntResolver.runAnt(antHome, buildXml, ['clone', `-Dtarget=${hook.target}`], {
                        'basedir': baseDir,
                        'REPOSITORY_PATH': repositoryPath,
                        'DEPLOYMENT_PATH': deploymentPath,
                        'ZIDE.PARENT_SERVICE': parentService
                    }, repositoryPath);

                    if (result.output) {
                        outputChannel.appendLine(result.output);
                    }

                    if (result.success) {
                        outputChannel.appendLine(`  ${hook.label} completed successfully.`);
                    } else {
                        outputChannel.appendLine(`  ${hook.label} FAILED.`);
                    }
                }

                outputChannel.appendLine(`\n=== Hooks completed ===\n`);
                showInfo(`${taskTitle} completed.`);
            }
        );
    }

    private static ensureRequiredProperties(
        zideResourcesPath: string,
        serviceKey: string,
        outputChannel: vscode.OutputChannel
    ): void {
        const propsFile = path.join(zideResourcesPath, 'zide_properties.xml');
        if (!fs.existsSync(propsFile)) { return; }

        const content = fs.readFileSync(propsFile, 'utf-8');
        const missing: Record<string, string> = {};

        for (const [key, defaultProvider] of Object.entries(REQUIRED_PROPERTIES)) {
            const regex = new RegExp(`name="${key.replace(/\./g, '\\.')}"`);
            if (!regex.test(content)) {
                const defaultValue = key === 'ZIDE.IAM_SERVICENAME' ? serviceKey : defaultProvider();
                missing[key] = defaultValue;
            }
        }

        if (Object.keys(missing).length === 0) { return; }

        outputChannel.appendLine(`  Validating zide_properties.xml: inserting ${Object.keys(missing).length} missing key(s)...`);

        let propsContent = content;
        const insertionPoint = propsContent.lastIndexOf('</properties>');
        if (insertionPoint === -1) { return; }

        let newEntries = '';
        for (const [key, value] of Object.entries(missing)) {
            const display = value || '(empty)';
            outputChannel.appendLine(`    + ${key} = ${display}`);
            newEntries += `    <property name="${key}" value="${value}"/>\n`;
        }

        propsContent = propsContent.substring(0, insertionPoint) + newEntries + propsContent.substring(insertionPoint);
        fs.writeFileSync(propsFile, propsContent, 'utf-8');
        outputChannel.appendLine('  zide_properties.xml updated.\n');
    }
}
