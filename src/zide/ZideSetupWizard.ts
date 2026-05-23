import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { TomcatServer } from '../model/TomcatServer';
import { StateManager } from '../persistence/StateManager';
import { PathResolver } from '../parser/PathResolver';
import { ZideConfigParser, ZideService } from '../parser/ZideConfigParser';
import { ModuleZidePropsParser } from '../parser/ModuleZidePropsParser';

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
                { placeHolder: 'Select a service' }
            );
            if (!picked) { return undefined; }
            selectedService = picked.service;
        }

        // Parse zide_properties.xml
        const zidePropsXmlPath = path.join(zideResourcesPath, 'zide_properties.xml');
        const envProps = ZideConfigParser.parseZidePropertiesXml(zidePropsXmlPath);

        // Parse Zide.properties (module-level)
        const zidePropsFile = PathResolver.findZidePropertiesFile(projectRoot);
        const moduleProps = zidePropsFile ? ModuleZidePropsParser.parse(zidePropsFile) : null;

        // Build server configuration
        const tomcatPath = selectedService.properties['tomcat.home'] ||
            envProps['tomcat.home'] ||
            path.join(projectRoot, 'tomcat');

        const port = parseInt(selectedService.properties['http.port'] || envProps['http.port'] || '8080', 10);
        const debugPort = parseInt(selectedService.properties['debug.port'] || envProps['debug.port'] || '8787', 10);
        const shutdownPort = parseInt(selectedService.properties['shutdown.port'] || envProps['shutdown.port'] || '9285', 10);
        const contextPath = selectedService.properties['context.path'] || envProps['context.path'] || `/${selectedService.name}`;
        const deploymentDir = selectedService.properties['deployment.dir'] || envProps['deployment.dir'] || '';

        const server: TomcatServer = {
            id: crypto.randomUUID(),
            name: selectedService.name || path.basename(projectRoot),
            path: tomcatPath,
            status: 'stopped',
            port,
            debugPort,
            shutdownPort,
            contextPath,
            deploymentDir,
            zideResourcesPath,
            zidePropertiesPath: zidePropsFile || '',
            serviceName: selectedService.name,
            antHome: selectedService.properties['ant.home'] || envProps['ant.home'] || '',
            javaHome: selectedService.properties['java.home'] || envProps['java.home'] || '',
            vmArguments: moduleProps?.launchVmArguments || selectedService.properties['vm.arguments'] || ''
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
        return server;
    }
}
