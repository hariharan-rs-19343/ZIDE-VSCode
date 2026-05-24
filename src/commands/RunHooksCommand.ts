import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
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
const PRELAUNCH: HookDef = { target: 'preservicelaunch', hookName: 'prelaunch', useZideHookDir: true, label: 'Pre-Launch Hook' };
const PGSQL_REINIT: HookDef = { target: 'pgsqlreinit', hookName: 'postreinit', useZideHookDir: false, label: 'PostgreSQL Reinit' };
const MYSQL_REINIT: HookDef = { target: 'mysqlreinit', hookName: 'postreinit', useZideHookDir: false, label: 'MySQL Reinit' };

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

    static async runPreLaunch(): Promise<void> {
        await this.runHooks([PRELAUNCH], 'Run Pre-Launch Hook');
    }

    static async runDbReinit(): Promise<void> {
        const dbType = await vscode.window.showQuickPick(
            ['PostgreSQL', 'MySQL'],
            { placeHolder: 'Select database type for reinit' }
        );
        if (!dbType) { return; }
        const hook = dbType === 'PostgreSQL' ? PGSQL_REINIT : MYSQL_REINIT;
        await this.runHooks([hook], `Run ${hook.label}`);
    }

    static async pickAndRun(): Promise<void> {
        const picks = [
            { label: 'Run All Hooks', hooks: [PRECREATION, POSTCREATION, ZIDEMODULE] },
            { label: PRECREATION.label, hooks: [PRECREATION] },
            { label: POSTCREATION.label, hooks: [POSTCREATION] },
            { label: ZIDEMODULE.label, hooks: [ZIDEMODULE] },
            { label: PRELAUNCH.label, hooks: [PRELAUNCH] },
            { label: 'DB Reinit (PostgreSQL)', hooks: [PGSQL_REINIT] },
            { label: 'DB Reinit (MySQL)', hooks: [MYSQL_REINIT] }
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
            if (server && server.deploymentDir) {
                const tomcatPath = path.join(server.deploymentDir, 'AdventNet', 'Sas', 'tomcat');
                deploymentPath = fs.existsSync(tomcatPath) ? tomcatPath : server.path;
            }
        }
        if (!deploymentPath) {
            const serviceXmlPath = path.join(zideResourcesPath, 'service.xml');
            if (fs.existsSync(serviceXmlPath)) {
                const serviceContent = fs.readFileSync(serviceXmlPath, 'utf-8');
                const deployFolder = serviceContent.match(/name="ZIDE\.DEPLOYMENT_FOLDER"\s+value="([^"]*)"/)?.[1];
                if (deployFolder) {
                    const tomcatPath = path.join(deployFolder, 'AdventNet', 'Sas', 'tomcat');
                    deploymentPath = fs.existsSync(tomcatPath) ? tomcatPath : deployFolder;
                }
            }
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

                    // Build comprehensive system properties (like Eclipse's buildAntHookSystemProperties)
                    const hookProperties = this.buildHookProperties(
                        repositoryPath, deploymentPath, parentService, zideResourcesPath, services[0]
                    );
                    hookProperties['basedir'] = baseDir;

                    const result = await AntResolver.runAnt(antHome, buildXml, ['clone', `-Dtarget=${hook.target}`],
                        hookProperties, repositoryPath);

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

    /**
     * Build comprehensive system properties for ANT hook execution.
     * Mirrors Eclipse's ProjectHook.buildAntHookSystemProperties():
     * - DOWNLOAD_URL from service config
     * - REPOSITORY_PATH.<moduledir> for parent + dependent services
     * - All zide_properties.xml entries
     * - All service.xml property entries
     */
    private static buildHookProperties(
        repositoryPath: string,
        deploymentPath: string,
        parentService: string,
        zideResourcesPath: string,
        parentServiceConfig?: { name: string; properties: Record<string, string> }
    ): Record<string, string> {
        const props: Record<string, string> = {};

        // Core properties (always included)
        props['REPOSITORY_PATH'] = repositoryPath;
        props['DEPLOYMENT_PATH'] = deploymentPath;
        props['ZIDE.PARENT_SERVICE'] = parentService;

        // DOWNLOAD_URL from service config
        if (parentServiceConfig?.properties['ZIDE.DOWNLOAD_URL']) {
            let dloadUrl = parentServiceConfig.properties['ZIDE.DOWNLOAD_URL'];
            // Strip filename from URL (Eclipse: dloadUrl.substring(0, dloadUrl.lastIndexOf("/")))
            const lastSlash = dloadUrl.lastIndexOf('/');
            if (lastSlash > 0 && dloadUrl.includes('://')) {
                dloadUrl = dloadUrl.substring(0, lastSlash);
            }
            props['DOWNLOAD_URL'] = dloadUrl;
        }

        // REPOSITORY_PATH.<moduledir> for parent and dependent services
        const serviceXmlPath = path.join(zideResourcesPath, 'service.xml');
        const services = ZideConfigParser.parseServiceXml(serviceXmlPath);
        for (const svc of services) {
            const moduleDir = svc.properties['ZIDE.MODULE_DIR'] || svc.name;
            props[`REPOSITORY_PATH.${moduleDir}`] = repositoryPath;
        }

        // All zide_properties.xml entries (key-value pairs passed directly)
        const propsFile = path.join(zideResourcesPath, 'zide_properties.xml');
        if (fs.existsSync(propsFile)) {
            const zideProps = ZideConfigParser.parseZidePropertiesXml(propsFile);
            for (const [key, value] of Object.entries(zideProps)) {
                if (value) {
                    props[key] = value;
                }
            }
        }

        // All service.xml property entries from the parent service
        if (parentServiceConfig) {
            for (const [key, value] of Object.entries(parentServiceConfig.properties)) {
                if (value && !props[key]) {
                    props[key] = value;
                }
            }
        }

        return props;
    }
}
