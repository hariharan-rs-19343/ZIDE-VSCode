import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { StateManager } from '../persistence/StateManager';
import { DeploymentConfigPatcher } from '../zide/DeploymentConfigPatcher';
import { showError, showInfo } from '../util/notificationUtil';

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

        const { content: existingContent, serviceKey } = this.loadExistingContent(server.zideResourcesPath);
        const extract = (key: string): string | undefined => {
            const match = existingContent.match(new RegExp(`name="${key.replace(/\./g, '\\.')}"\\s+value="([^"]*)"`));
            return match?.[1];
        };

        const hostName = await vscode.window.showInputBox({
            prompt: 'Host Name',
            value: extract('ZIDE.HOST_NAME') || 'localhost',
            validateInput: v => v.trim() ? undefined : 'Host name cannot be empty'
        });
        if (hostName === undefined) { return; }

        const userMail = await vscode.window.showInputBox({
            prompt: 'User Email',
            value: extract('ZIDE.USER_MAIL') || `${process.env['USER'] || ''}@zohocorp.com`,
            validateInput: v => v.trim() ? undefined : 'Email cannot be empty'
        });
        if (userMail === undefined) { return; }

        const iamServer = await vscode.window.showInputBox({
            prompt: 'IAM Server URL',
            value: extract('ZIDE.IAM_SERVER') || 'https://accounts.csez.zohocorpin.com'
        });
        if (iamServer === undefined) { return; }

        const httpPort = await vscode.window.showInputBox({
            prompt: 'HTTP Port',
            value: extract('ZIDE.HTTP_PORT') || String(server.port),
            validateInput: v => {
                const n = Number(v);
                return Number.isInteger(n) && n >= 1 && n <= 65535 ? undefined : 'Port must be 1-65535';
            }
        });
        if (httpPort === undefined) { return; }

        const httpsPort = await vscode.window.showInputBox({
            prompt: 'HTTPS Port',
            value: extract('ZIDE.HTTPS_PORT') || '8443',
            validateInput: v => {
                const n = Number(v);
                return Number.isInteger(n) && n >= 1 && n <= 65535 ? undefined : 'Port must be 1-65535';
            }
        });
        if (httpsPort === undefined) { return; }

        const iamServiceName = await vscode.window.showInputBox({
            prompt: 'IAM Service Name',
            value: extract('ZIDE.IAM_SERVICENAME') || serviceKey,
            placeHolder: 'e.g. ZhareHub'
        });
        if (iamServiceName === undefined) { return; }

        const currentDbType = extract('ZIDE_DB_TYPE') || 'PGSQL';
        const isPgsql = currentDbType.toUpperCase() === 'PGSQL' || currentDbType.toLowerCase().includes('postgres');
        const dbType = await vscode.window.showQuickPick(
            ['PostgreSQL', 'MySQL'],
            { placeHolder: 'Select Database Type' }
        );
        if (!dbType) { return; }

        const dbHost = await vscode.window.showInputBox({
            prompt: 'Database Hostname',
            value: extract('ZIDE_DB_HOST') || 'localhost',
            validateInput: v => v.trim() ? undefined : 'Database host cannot be empty'
        });
        if (dbHost === undefined) { return; }

        const dbUser = await vscode.window.showInputBox({
            prompt: 'Database Username',
            value: extract('ZIDE_DB_USER') || 'root',
            validateInput: v => v.trim() ? undefined : 'Database username cannot be empty'
        });
        if (dbUser === undefined) { return; }

        const dbPassword = await vscode.window.showInputBox({
            prompt: 'Database Password',
            password: true,
            value: extract('ZIDE_DB_PASS') || ''
        });
        if (dbPassword === undefined) { return; }

        const dbName = await vscode.window.showInputBox({
            prompt: 'Database Name',
            value: extract('ZIDE_DB_NAME') || ''
        });
        if (dbName === undefined) { return; }

        const dbSchema = await vscode.window.showInputBox({
            prompt: 'Schema Name',
            value: extract('ZIDE.SCHEMA_NAME') || 'jbossdb'
        });
        if (dbSchema === undefined) { return; }

        const dbTypeValue = dbType === 'PostgreSQL' ? 'PGSQL' : 'MYSQL';
        const userName = process.env['USER'] || '';

        // Write updates using IntelliJ-compatible format
        const updates: Record<string, string> = {
            'ZIDE.HOST_NAME': hostName,
            'ZIDE.USER_MAIL': userMail,
            'ZIDE.IAM_SERVER': iamServer,
            'ZIDE.HTTP_PORT': httpPort,
            'ZIDE.HTTPS_PORT': httpsPort,
            'ZIDE.IAM_SERVICENAME': iamServiceName,
            'ZIDE_DB_TYPE': dbTypeValue,
            'ZIDE_DB_HOST': dbHost,
            'ZIDE_DB_USER': dbUser,
            'ZIDE_DB_PASS': dbPassword,
            'ZIDE_DB_NAME': dbName,
            'ZIDE.SCHEMA_NAME': dbSchema
        };

        this.writePropertiesToXml(server.zideResourcesPath, serviceKey, updates);

        // Trigger full config patching
        await DeploymentConfigPatcher.patchAll(server);

        showInfo('Deployment properties updated');
    }

    private static loadExistingContent(zideResourcesPath: string): { content: string; serviceKey: string } {
        const propsFile = path.join(zideResourcesPath, 'zide_properties.xml');
        if (!fs.existsSync(propsFile)) { return { content: '', serviceKey: '' }; }

        const content = fs.readFileSync(propsFile, 'utf-8');
        const keyMatch = content.match(/service\s+key="([^"]*)"/);
        return { content, serviceKey: keyMatch?.[1] || '' };
    }

    private static writePropertiesToXml(
        zideResourcesPath: string,
        serviceKey: string,
        updates: Record<string, string>
    ): void {
        const propsFile = path.join(zideResourcesPath, 'zide_properties.xml');

        if (!fs.existsSync(propsFile)) {
            // Create new file with IntelliJ-compatible structure
            const entries = Object.entries(updates)
                .map(([k, v]) => `    <property name="${k}" value="${v.replace(/"/g, '&quot;')}"/>`)
                .join('\n');
            const content = `<?xml version="1.0" encoding="UTF-8"?>
<services>
  <service key="${serviceKey}">
${entries}
  </service>
</services>`;
            fs.writeFileSync(propsFile, content, 'utf-8');
            return;
        }

        let content = fs.readFileSync(propsFile, 'utf-8');
        const missingKeys: Array<[string, string]> = [];

        for (const [name, value] of Object.entries(updates)) {
            const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(<property\\s+name="${escapedName}"\\s+value=")[^"]*(")`);
            if (regex.test(content)) {
                content = content.replace(regex, `$1${value.replace(/"/g, '&quot;')}$2`);
            } else {
                missingKeys.push([name, value]);
            }
        }

        if (missingKeys.length > 0) {
            const serviceCloseTag = '</service>';
            const insertionPoint = content.lastIndexOf(serviceCloseTag);
            if (insertionPoint >= 0) {
                const newEntries = missingKeys
                    .map(([k, v]) => `    <property name="${k}" value="${v.replace(/"/g, '&quot;')}"/>`)
                    .join('\n');
                content = content.substring(0, insertionPoint) + newEntries + '\n' + content.substring(insertionPoint);
            }
        }

        fs.writeFileSync(propsFile, content, 'utf-8');
    }
}
