import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StateManager } from '../persistence/StateManager';
import { DeploymentConfigPatcher } from '../zide/DeploymentConfigPatcher';
import { showError, showInfo } from '../util/notificationUtil';

interface DeploymentProps {
    hostName: string;
    iamServer: string;
    httpPort: string;
    httpsPort: string;
    dbType: string;
    dbHost: string;
    dbPort: string;
    dbUser: string;
    dbPassword: string;
    dbSchema: string;
}

export class DeploymentPropertiesCommand {
    static async run(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            showError('No workspace folder open');
            return;
        }

        const projectDir = workspaceFolder.uri.fsPath;
        const mapping = StateManager.getInstance().getMappingForProject(projectDir);
        if (!mapping) {
            showError('No server configured for this project');
            return;
        }
        const server = StateManager.getInstance().getServer(mapping.serverId);
        if (!server) {
            showError('Server not found');
            return;
        }

        // Load existing values from zide_properties.xml if available
        const existingProps = this.loadExistingProps(server.zideResourcesPath);

        // Collect properties via InputBoxes
        const hostName = await vscode.window.showInputBox({
            prompt: 'Host Name',
            value: existingProps.hostName || 'localhost'
        });
        if (hostName === undefined) { return; }

        const iamServer = await vscode.window.showInputBox({
            prompt: 'IAM Server URL',
            value: existingProps.iamServer || 'https://localhost:9443'
        });
        if (iamServer === undefined) { return; }

        const httpPort = await vscode.window.showInputBox({
            prompt: 'HTTP Port',
            value: existingProps.httpPort || String(server.port)
        });
        if (httpPort === undefined) { return; }

        const httpsPort = await vscode.window.showInputBox({
            prompt: 'HTTPS Port',
            value: existingProps.httpsPort || '8443'
        });
        if (httpsPort === undefined) { return; }

        const dbType = await vscode.window.showQuickPick(
            ['postgres', 'mysql'],
            { placeHolder: 'Database Type' }
        );
        if (!dbType) { return; }

        const defaultDbPort = dbType === 'postgres' ? '5432' : '3306';
        const dbHost = await vscode.window.showInputBox({
            prompt: 'Database Host',
            value: existingProps.dbHost || 'localhost'
        });
        if (dbHost === undefined) { return; }

        const dbPort = await vscode.window.showInputBox({
            prompt: 'Database Port',
            value: existingProps.dbPort || defaultDbPort
        });
        if (dbPort === undefined) { return; }

        const dbUser = await vscode.window.showInputBox({
            prompt: 'Database User',
            value: existingProps.dbUser || 'postgres'
        });
        if (dbUser === undefined) { return; }

        const dbPassword = await vscode.window.showInputBox({
            prompt: 'Database Password',
            password: true,
            value: ''
        });
        if (dbPassword === undefined) { return; }

        const dbSchema = await vscode.window.showInputBox({
            prompt: 'Database Schema/Name',
            value: existingProps.dbSchema || server.serviceName
        });
        if (dbSchema === undefined) { return; }

        // Save to zide_properties.xml
        const props: DeploymentProps = {
            hostName, iamServer, httpPort, httpsPort,
            dbType, dbHost, dbPort, dbUser, dbPassword, dbSchema
        };

        await this.saveProps(server.zideResourcesPath, props);

        // Patch configuration files
        if (server.deploymentDir) {
            const configPath = path.join(server.deploymentDir, 'WEB-INF', 'conf', 'configuration.properties');
            if (fs.existsSync(configPath)) {
                const driver = dbType === 'postgres' ? 'org.postgresql.Driver' : 'com.mysql.cj.jdbc.Driver';
                const dbUrl = dbType === 'postgres'
                    ? `jdbc:postgresql://${dbHost}:${dbPort}/${dbSchema}`
                    : `jdbc:mysql://${dbHost}:${dbPort}/${dbSchema}`;

                DeploymentConfigPatcher.patchConfigProperty(configPath, 'db.driver', driver);
                DeploymentConfigPatcher.patchConfigProperty(configPath, 'db.url', dbUrl);
                DeploymentConfigPatcher.patchConfigProperty(configPath, 'db.username', dbUser);
                DeploymentConfigPatcher.patchConfigProperty(configPath, 'db.password', dbPassword);
                DeploymentConfigPatcher.patchConfigProperty(configPath, 'http.port', httpPort);
                DeploymentConfigPatcher.patchConfigProperty(configPath, 'https.port', httpsPort);
            }
        }

        showInfo('Deployment properties updated');
    }

    private static loadExistingProps(zideResourcesPath: string): Partial<DeploymentProps> {
        const propsFile = path.join(zideResourcesPath, 'zide_properties.xml');
        if (!fs.existsSync(propsFile)) { return {}; }

        // Simple key-value extraction from XML
        const content = fs.readFileSync(propsFile, 'utf-8');
        const extract = (key: string): string | undefined => {
            const match = content.match(new RegExp(`name="${key}"\\s+value="([^"]*)"`));
            return match?.[1];
        };

        return {
            hostName: extract('host.name'),
            iamServer: extract('iam.server'),
            httpPort: extract('http.port'),
            httpsPort: extract('https.port'),
            dbType: extract('db.type'),
            dbHost: extract('db.host'),
            dbPort: extract('db.port'),
            dbUser: extract('db.user'),
            dbSchema: extract('db.schema')
        };
    }

    private static async saveProps(zideResourcesPath: string, props: DeploymentProps): Promise<void> {
        const propsFile = path.join(zideResourcesPath, 'zide_properties.xml');
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<properties>
    <property name="host.name" value="${props.hostName}"/>
    <property name="iam.server" value="${props.iamServer}"/>
    <property name="http.port" value="${props.httpPort}"/>
    <property name="https.port" value="${props.httpsPort}"/>
    <property name="db.type" value="${props.dbType}"/>
    <property name="db.host" value="${props.dbHost}"/>
    <property name="db.port" value="${props.dbPort}"/>
    <property name="db.user" value="${props.dbUser}"/>
    <property name="db.password" value="${props.dbPassword}"/>
    <property name="db.schema" value="${props.dbSchema}"/>
</properties>`;
        fs.writeFileSync(propsFile, content, 'utf-8');
    }
}
