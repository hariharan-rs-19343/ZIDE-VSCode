import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { TomcatServer } from '../model/TomcatServer';
import { StateManager } from '../persistence/StateManager';
import { PathResolver } from '../parser/PathResolver';
import { ZideConfigParser, ZideService } from '../parser/ZideConfigParser';
import { ModuleZidePropsParser } from '../parser/ModuleZidePropsParser';

/**
 * Detect if ZIDE configuration exists in the given project path (from old extension).
 */
export async function detectZideConfigInProject(projectPath: string): Promise<boolean> {
    const zideResourcesPath = path.join(projectPath, '.zide_resources');
    const serviceXmlPath = path.join(zideResourcesPath, 'service.xml');
    const propertiesXmlPath = path.join(zideResourcesPath, 'zide_properties.xml');
    return fs.existsSync(serviceXmlPath) && fs.existsSync(propertiesXmlPath);
}

/**
 * Find the default zide folder (sibling of project — from old extension).
 */
function findDefaultZideFolder(projectPath: string): string | undefined {
    const parentPath = path.dirname(path.resolve(projectPath));
    const candidate = path.join(parentPath, 'zide');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
    }
    return undefined;
}

/**
 * Resolve the Zide.properties path within a zide folder.
 */
function resolveModuleZidePropsPath(zideFolderPath: string, repositoryModuleDir: string, deployType: string = 'M19'): string {
    return path.join(zideFolderPath, 'deployment', repositoryModuleDir, deployType, 'Zide.properties');
}

/**
 * Ask user to pick a zide folder when the default one is not found (from old extension).
 */
async function askUserForZideFolder(projectPath: string): Promise<string | undefined> {
    const selectedFolder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: vscode.Uri.file(path.dirname(projectPath)),
        openLabel: 'Select zide Folder',
        title: 'Select zide folder to resolve launch.vmarguments'
    });

    if (!selectedFolder || selectedFolder.length === 0) {
        return undefined;
    }
    return selectedFolder[0].fsPath;
}

export class ZideSetupWizard {
    static async run(projectRoot: string): Promise<TomcatServer | undefined> {
        // Find .zide_resources
        const zideResourcesPath = PathResolver.resolveZideResourcesPath(projectRoot);
        if (!zideResourcesPath) {
            vscode.window.showErrorMessage('ZIDE: Could not find .zide_resources directory');
            return undefined;
        }

        // Parse service.xml
        const serviceXmlPath = path.join(zideResourcesPath, 'service.xml');
        const services = ZideConfigParser.parseServiceXml(serviceXmlPath);

        if (services.length === 0) {
            vscode.window.showErrorMessage('ZIDE: No services found in service.xml');
            return undefined;
        }

        // Select service if multiple
        let selectedService: ZideService;
        if (services.length === 1) {
            selectedService = services[0];
        } else {
            const picked = await vscode.window.showQuickPick(
                services.map(s => ({ label: s.name, service: s })),
                { placeHolder: 'Select a service', ignoreFocusOut: true }
            );
            if (!picked) { return undefined; }
            selectedService = picked.service;
        }

        // Parse zide_properties.xml
        const zidePropsXmlPath = path.join(zideResourcesPath, 'zide_properties.xml');
        const envProps = ZideConfigParser.parseZidePropertiesXml(zidePropsXmlPath);

        // --- Extract repositoryModuleDir and deployType (from old extension) ---
        const repositoryModuleDir = selectedService.properties['ZIDE.REPOSITORY_MODULE_DIR']
            || services[0]?.properties['ZIDE.REPOSITORY_MODULE_DIR']
            || '';
        const deployType = selectedService.properties['ZIDE.DEPLOY_TYPE']
            || services[0]?.properties['ZIDE.DEPLOY_TYPE']
            || 'M19';

        // --- Resolve zide folder and Zide.properties (from old extension) ---
        let zideFolderPath = findDefaultZideFolder(projectRoot);
        let zidePropertiesPath: string | undefined;
        let moduleProps: ReturnType<typeof ModuleZidePropsParser.parse> | null = null;

        if (zideFolderPath && repositoryModuleDir) {
            zidePropertiesPath = resolveModuleZidePropsPath(zideFolderPath, repositoryModuleDir, deployType);
            if (fs.existsSync(zidePropertiesPath)) {
                moduleProps = ModuleZidePropsParser.parse(zidePropertiesPath);
            }
        }

        // If we couldn't find moduleProps and we have a repositoryModuleDir, ask user (from old extension)
        if (!moduleProps && repositoryModuleDir) {
            const pickedZideFolder = await askUserForZideFolder(projectRoot);
            if (pickedZideFolder) {
                zideFolderPath = pickedZideFolder;
                zidePropertiesPath = resolveModuleZidePropsPath(zideFolderPath, repositoryModuleDir, deployType);
                if (fs.existsSync(zidePropertiesPath)) {
                    moduleProps = ModuleZidePropsParser.parse(zidePropertiesPath);
                } else {
                    vscode.window.showWarningMessage(
                        `ZIDE: Could not resolve Zide.properties under ${zideFolderPath}/deployment/${repositoryModuleDir}/${deployType}. Continuing without launch.vmarguments.`
                    );
                }
            }
        }

        // Also try local Zide.properties (fallback)
        if (!moduleProps) {
            const localPropsFile = PathResolver.findZidePropertiesFile(projectRoot);
            if (localPropsFile) {
                zidePropertiesPath = localPropsFile;
                moduleProps = ModuleZidePropsParser.parse(localPropsFile);
            }
        }

        // Derive Tomcat path from ZIDE.DEPLOYMENT_FOLDER
        const deploymentFolder = selectedService.properties['ZIDE.DEPLOYMENT_FOLDER'] || '';
        let tomcatPath: string;

        if (deploymentFolder) {
            const candidateTomcat = path.join(deploymentFolder, 'AdventNet', 'Sas', 'tomcat');
            tomcatPath = fs.existsSync(candidateTomcat) ? candidateTomcat : deploymentFolder;
        } else {
            tomcatPath = selectedService.properties['tomcat.home'] ||
                envProps['tomcat.home'] ||
                path.join(projectRoot, 'tomcat');
        }

        // --- Validate Tomcat path (from old extension) ---
        const catalinaScript = path.join(tomcatPath, 'bin', 'catalina.sh');
        if (!fs.existsSync(catalinaScript)) {
            if (!deploymentFolder) {
                vscode.window.showErrorMessage('ZIDE: ZIDE.DEPLOYMENT_FOLDER not found in service.xml configuration.');
            } else {
                vscode.window.showErrorMessage(`ZIDE: Invalid Tomcat path: ${tomcatPath}\n\nEnsure it contains bin/catalina.sh`);
            }
            return undefined;
        }

        const serviceKey = selectedService.properties['ZIDE.SERVICE_KEY'] || selectedService.name;
        const parentService = selectedService.properties['ZIDE.PARENT_SERVICE'] || selectedService.name || path.basename(projectRoot);
        const tomcatVersion = selectedService.properties['ZIDE.TOMCAT_VERSION'] || '';

        // deploymentDir = webapp directory (where WEB-INF lives), NOT deployment root
        const deploymentDir = path.join(tomcatPath, 'webapps', parentService);

        const port = parseInt(
            envProps['ZIDE.HTTP_PORT'] || selectedService.properties['http.port'] || envProps['http.port'] || '8080', 10
        );
        const debugPort = parseInt(
            selectedService.properties['debug.port'] || envProps['debug.port'] || '8787', 10
        );
        const shutdownPort = parseInt(
            selectedService.properties['shutdown.port'] || envProps['shutdown.port'] || '9285', 10
        );
        const contextPath = selectedService.properties['context.path'] ||
            envProps['context.path'] ||
            `/${parentService}`;

        // --- Build runtime properties map (from old extension) ---
        const zideRuntimeProperties: Record<string, string> = {
            ...selectedService.properties,
            ...envProps
        };

        // --- Server name includes version hint (from old extension) ---
        const serverName = tomcatVersion
            ? `ZIDE-${parentService} (${tomcatVersion})`
            : parentService || path.basename(projectRoot);

        const server: TomcatServer = {
            id: crypto.randomUUID(),
            name: serverName,
            path: tomcatPath,
            status: 'stopped',
            port,
            debugPort,
            shutdownPort,
            contextPath,
            deploymentDir,
            zideResourcesPath,
            zidePropertiesPath: zidePropertiesPath || '',
            serviceName: serviceKey,
            antHome: selectedService.properties['ant.home'] || envProps['ant.home'] || '',
            javaHome: selectedService.properties['ZIDE.PROJECT_JRE_HOME'] || envProps['java.home'] || '',
            vmArguments: '',
            description: `Auto-configured from ZIDE service: ${serviceKey}`,
            zideServiceKey: serviceKey,
            zideFolderPath: zideFolderPath,
            zideLaunchVmArguments: moduleProps?.launchVmArguments || '',
            repositoryModuleDir,
            deployType,
            zideRuntimeProperties
        };

        // Register server
        await StateManager.getInstance().addServer(server);

        // Register mapping
        await StateManager.getInstance().addMapping({
            projectPath: projectRoot,
            serverId: server.id,
            contextPath: server.contextPath,
            warFilePath: ''
        });

        vscode.window.showInformationMessage(`ZIDE: Server "${server.name}" configured from project`);

        // Auto-configure workspace: Java classpath + launch configs
        this.configureWorkspace(projectRoot, server, deploymentFolder);

        return server;
    }

    private static configureWorkspace(projectRoot: string, server: TomcatServer, deploymentFolder: string): void {
        const vscodeDir = path.join(projectRoot, '.vscode');
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        // 1. Java classpath: add WEB-INF/lib jars to referencedLibraries
        const parentService = server.zideRuntimeProperties?.['ZIDE.PARENT_SERVICE'] || server.serviceName;
        const webinfLib = path.join(deploymentFolder, 'AdventNet', 'Sas', 'tomcat', 'webapps', parentService, 'WEB-INF', 'lib');
        const tomcatLib = path.join(deploymentFolder, 'AdventNet', 'Sas', 'tomcat', 'lib');

        const settingsPath = path.join(vscodeDir, 'settings.json');
        let settings: Record<string, unknown> = {};
        if (fs.existsSync(settingsPath)) {
            try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch { settings = {}; }
        }

        const libs: string[] = [];
        if (fs.existsSync(webinfLib)) { libs.push(path.join(webinfLib, '**', '*.jar')); }
        if (fs.existsSync(tomcatLib)) { libs.push(path.join(tomcatLib, '**', '*.jar')); }
        libs.push('lib/**/*.jar');

        settings['java.project.referencedLibraries'] = libs;

        // Set compiled class output to deployment WEB-INF/classes
        // const webinfClasses = path.join(deploymentFolder, 'AdventNet', 'Sas', 'tomcat', 'webapps', parentService, 'WEB-INF', 'classes');
        // settings['java.project.outputPath'] = webinfClasses;
        settings['java.project.sourcePaths'] = ['src/main/java'];

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), 'utf-8');

        // 2. Generate tasks.json for ZIDE server tasks
        const tasksPath = path.join(vscodeDir, 'tasks.json');
        const tasksContent = {
            version: '2.0.0',
            tasks: [
                {
                    label: 'ZIDE: Run Server',
                    type: 'shell',
                    command: '${command:zide.run}',
                    problemMatcher: [],
                    group: { kind: 'build', isDefault: false }
                },
                {
                    label: 'ZIDE: Debug Server',
                    type: 'shell',
                    command: '${command:zide.debug}',
                    problemMatcher: [],
                    group: { kind: 'build', isDefault: false }
                },
                {
                    label: 'ZIDE: Stop Server',
                    type: 'shell',
                    command: '${command:zide.stop}',
                    problemMatcher: []
                }
            ]
        };
        fs.writeFileSync(tasksPath, JSON.stringify(tasksContent, null, 4), 'utf-8');

        // 3. Generate launch.json for Run/Debug buttons in editor title bar
        const launchPath = path.join(vscodeDir, 'launch.json');
        if (!fs.existsSync(launchPath)) {
            const launchContent = {
                version: '0.2.0',
                configurations: [
                    {
                        type: 'java',
                        name: 'ZIDE: Run Server',
                        request: 'attach',
                        hostName: 'localhost',
                        port: server.debugPort,
                        preLaunchTask: 'ZIDE: Run Server'
                    },
                    {
                        type: 'java',
                        name: 'ZIDE: Debug Server',
                        request: 'attach',
                        hostName: 'localhost',
                        port: server.debugPort,
                        preLaunchTask: 'ZIDE: Debug Server'
                    }
                ]
            };
            fs.writeFileSync(launchPath, JSON.stringify(launchContent, null, 4), 'utf-8');
        }
    }
}
