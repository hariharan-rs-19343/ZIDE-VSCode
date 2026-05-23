import * as fs from 'fs';
import * as path from 'path';
import { TomcatServer } from '../model/TomcatServer';

export class DeploymentConfigPatcher {
    static async patchAll(server: TomcatServer): Promise<void> {
        await this.patchServerXml(server);
        await this.patchWebXml(server);
        await this.patchConfigurationProperties(server);
        await this.patchPersistenceConfigurations(server);
        await this.patchSecurityProperties(server);
    }

    static async patchServerXml(server: TomcatServer): Promise<void> {
        const serverXmlPath = path.join(server.path, 'conf', 'server.xml');
        if (!fs.existsSync(serverXmlPath)) { return; }

        let content = fs.readFileSync(serverXmlPath, 'utf-8');

        // Patch shutdown port
        content = content.replace(
            /port="[^"]*"\s+shutdown="SHUTDOWN"/,
            `port="${server.shutdownPort}" shutdown="SHUTDOWN"`
        );

        // Patch HTTP connector port
        content = content.replace(
            /(<Connector\s+port=")[^"]*("\s+protocol="HTTP\/1\.1")/,
            `$1${server.port}$2`
        );

        // Ensure deployOnStartup="false"
        if (!content.includes('deployOnStartup')) {
            content = content.replace(
                /(<Host\s+[^>]*)(>)/,
                '$1 deployOnStartup="false"$2'
            );
        } else {
            content = content.replace(
                /deployOnStartup="[^"]*"/,
                'deployOnStartup="false"'
            );
        }

        // Add Context element if not present
        if (server.contextPath && server.deploymentDir) {
            const contextElement = `    <Context path="${server.contextPath}" docBase="${server.deploymentDir}" reloadable="false" />`;
            if (!content.includes(`path="${server.contextPath}"`)) {
                content = content.replace(
                    /(<\/Host>)/,
                    `${contextElement}\n      $1`
                );
            }
        }

        fs.writeFileSync(serverXmlPath, content, 'utf-8');
    }

    static async patchWebXml(server: TomcatServer): Promise<void> {
        const webXmlPath = path.join(server.path, 'conf', 'web.xml');
        if (!fs.existsSync(webXmlPath)) { return; }

        let content = fs.readFileSync(webXmlPath, 'utf-8');

        // Add JSP servlet with fork=false if not present
        const jspForkParam = `<init-param>
            <param-name>fork</param-name>
            <param-value>false</param-value>
        </init-param>`;

        if (!content.includes('<param-name>fork</param-name>')) {
            // Insert fork=false into JSP servlet definition
            content = content.replace(
                /(<servlet-name>jsp<\/servlet-name>[\s\S]*?<servlet-class>[^<]+<\/servlet-class>)/,
                `$1\n        ${jspForkParam}`
            );
        }

        fs.writeFileSync(webXmlPath, content, 'utf-8');
    }

    static async patchConfigurationProperties(server: TomcatServer): Promise<void> {
        if (!server.deploymentDir) { return; }

        const configPath = path.join(server.deploymentDir, 'WEB-INF', 'conf', 'configuration.properties');
        if (!fs.existsSync(configPath)) { return; }

        // Configuration properties are patched on-demand via DeploymentPropertiesCommand
        // This ensures the file exists and is accessible
    }

    static async patchPersistenceConfigurations(server: TomcatServer): Promise<void> {
        if (!server.deploymentDir) { return; }

        const persistencePath = path.join(server.deploymentDir, 'WEB-INF', 'conf', 'persistence-configurations.xml');
        if (!fs.existsSync(persistencePath)) { return; }

        let content = fs.readFileSync(persistencePath, 'utf-8');

        // Set StartDBServer=false
        content = content.replace(
            /(<property\s+name="StartDBServer"\s+value=")[^"]*(")/g,
            '$1false$2'
        );

        fs.writeFileSync(persistencePath, content, 'utf-8');
    }

    static async patchSecurityProperties(server: TomcatServer): Promise<void> {
        if (!server.deploymentDir) { return; }

        const securityPath = path.join(server.deploymentDir, 'WEB-INF', 'conf', 'security-properties.xml');
        if (!fs.existsSync(securityPath)) { return; }

        // Security properties are patched based on deployment properties (IAM server, service name, etc.)
        // Actual values come from the Deployment Properties command
    }

    static patchConfigProperty(filePath: string, key: string, value: string): void {
        if (!fs.existsSync(filePath)) { return; }

        let content = fs.readFileSync(filePath, 'utf-8');
        const regex = new RegExp(`^(${escapeRegex(key)}\\s*=).*$`, 'm');

        if (regex.test(content)) {
            content = content.replace(regex, `$1${value}`);
        } else {
            content += `\n${key}=${value}`;
        }

        fs.writeFileSync(filePath, content, 'utf-8');
    }
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
