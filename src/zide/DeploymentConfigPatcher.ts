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

        const zidePropsPath = path.join(server.zideResourcesPath, 'zide_properties.xml');
        if (!fs.existsSync(zidePropsPath)) { return; }

        const propsContent = fs.readFileSync(zidePropsPath, 'utf-8');
        const extract = (key: string): string | undefined => {
            const match = propsContent.match(new RegExp(`name="${key}"\\s+value="([^"]*)"`));
            return match?.[1];
        };

        const dbType = extract('ZIDE_DB_TYPE') || extract('db.type') || '';
        const isPgsql = dbType.toUpperCase() === 'PGSQL' || dbType.toUpperCase() === 'POSTGRESQL';

        const replacements: Record<string, string> = isPgsql ? {
            'db.drivername': 'org.postgresql.Driver',
            'db.username': extract('ZIDE_DB_USER') || extract('db.user') || 'root',
            'db.password': extract('ZIDE_DB_PASS') || extract('db.password') || '',
            'db.url': 'jdbc:postgresql://$host:$port/$dbName?charSet=UNICODE',
            'db.port': '5432',
            'db.schemaname': extract('ZIDE.SCHEMA_NAME') || extract('db.schema') || 'jbossdb',
            'db.name': extract('ZIDE_DB_NAME') || extract('db.name') || 'postgres',
            'db.vendor.name': 'postgres',
            'sas.dbserver.name': 'POSTGRES'
        } : {
            'db.drivername': 'org.gjt.mm.mysql.Driver',
            'db.username': extract('ZIDE_DB_USER') || extract('db.user') || 'root',
            'db.password': extract('ZIDE_DB_PASS') || extract('db.password') || '',
            'db.url': 'jdbc:mysql://$host:$port/$dbName?',
            'db.port': '3306',
            'db.schemaname': extract('ZIDE.SCHEMA_NAME') || extract('db.schema') || 'jbossdb',
            'db.name': 'mysql',
            'db.vendor.name': 'mysql',
            'sas.dbserver.name': 'MYSQL'
        };

        for (const [key, value] of Object.entries(replacements)) {
            this.patchConfigProperty(configPath, key, value);
        }
    }

    static async patchPersistenceConfigurations(server: TomcatServer): Promise<void> {
        if (!server.deploymentDir) { return; }

        const persistencePath = path.join(server.deploymentDir, 'WEB-INF', 'conf', 'Persistence', 'persistence-configurations.xml');
        const altPath = path.join(server.deploymentDir, 'WEB-INF', 'conf', 'persistence-configurations.xml');
        const actualPath = fs.existsSync(persistencePath) ? persistencePath : altPath;
        if (!fs.existsSync(actualPath)) { return; }

        let content = fs.readFileSync(actualPath, 'utf-8');

        content = content.replace(
            /(<configuration\s+name="StartDBServer"\s+value=")[^"]*(")/g,
            '$1false$2'
        );

        const zidePropsPath = path.join(server.zideResourcesPath, 'zide_properties.xml');
        if (fs.existsSync(zidePropsPath)) {
            const propsContent = fs.readFileSync(zidePropsPath, 'utf-8');
            const dbType = propsContent.match(/name="(?:ZIDE_DB_TYPE|db\.type)"\s+value="([^"]*)"/)?.[1] || '';
            const isPgsql = dbType.toUpperCase() === 'PGSQL' || dbType.toUpperCase() === 'POSTGRESQL';

            const dbNameValue = isPgsql ? 'postgres' : 'mysql';
            content = content.replace(
                /(<configuration\s+name="DBName"\s+value=")[^"]*(")/g,
                `$1${dbNameValue}$2`
            );

            const dsAdapterValue = isPgsql ? 'saspg' : 'sas';
            content = content.replace(
                /(<configuration\s+name="DSAdapter"\s+value=")[^"]*(")/,
                `$1${dsAdapterValue}$2`
            );
        }

        fs.writeFileSync(actualPath, content, 'utf-8');
    }

    static async patchSecurityProperties(server: TomcatServer): Promise<void> {
        if (!server.deploymentDir) { return; }

        const securityPath = path.join(server.deploymentDir, 'WEB-INF', 'security-properties.xml');
        if (!fs.existsSync(securityPath)) { return; }

        const zidePropsPath = path.join(server.zideResourcesPath, 'zide_properties.xml');
        if (!fs.existsSync(zidePropsPath)) { return; }

        const propsContent = fs.readFileSync(zidePropsPath, 'utf-8');
        const extract = (key: string): string | undefined => {
            const match = propsContent.match(new RegExp(`name="${key}"\\s+value="([^"]*)"`));
            return match?.[1];
        };

        let content = fs.readFileSync(securityPath, 'utf-8');
        let modified = false;

        const iamServer = extract('ZIDE.IAM_SERVER') || extract('iam.server');
        if (iamServer) {
            const iamRegex = /(<property\s+name="com\.adventnet\.iam\.internal\.server"\s+value=")[^"]*(")/g;
            const newContent = content.replace(iamRegex, `$1${iamServer}$2`);
            if (newContent !== content) { content = newContent; modified = true; }
        }

        const serviceName = extract('ZIDE.IAM_SERVICENAME') || extract('iam.service.name');
        if (serviceName) {
            const serviceRegex = /(<property\s+name="service\.name"\s+value=")[^"]*(")/g;
            const newContent = content.replace(serviceRegex, `$1${serviceName}$2`);
            if (newContent !== content) { content = newContent; modified = true; }
        }

        const hostName = extract('ZIDE.HOST_NAME') || extract('host.name');
        const httpsPort = extract('ZIDE.HTTPS_PORT') || extract('https.port');
        if (hostName && httpsPort && serviceName) {
            const logoutUrl = `https://${hostName}:${httpsPort}/logout?servicename=${serviceName}`;
            const logoutRegex = /(<property\s+name="logout\.page"\s+value=")[^"]*(")/g;
            const newContent = content.replace(logoutRegex, `$1${logoutUrl}$2`);
            if (newContent !== content) { content = newContent; modified = true; }
        }

        if (modified) {
            fs.writeFileSync(securityPath, content, 'utf-8');
        }
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
