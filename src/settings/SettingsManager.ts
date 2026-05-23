import * as vscode from 'vscode';

const SECRET_WGET_PASSWORD = 'zide.wget_password';
const SECRET_GIT_PASSWORD = 'zide.git_password';
const SECRET_ZOHO_REPO_PASSWORD = 'zide.zoho_repo_password';

export class SettingsManager {
    private static instance: SettingsManager;
    private secrets: vscode.SecretStorage;

    private constructor(secrets: vscode.SecretStorage) {
        this.secrets = secrets;
    }

    static initialize(secrets: vscode.SecretStorage): SettingsManager {
        SettingsManager.instance = new SettingsManager(secrets);
        return SettingsManager.instance;
    }

    static getInstance(): SettingsManager {
        if (!SettingsManager.instance) {
            throw new Error('SettingsManager not initialized');
        }
        return SettingsManager.instance;
    }

    private getConfig(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('zide');
    }

    get cmToolAuthToken(): string {
        return this.getConfig().get<string>('cmToolAuthToken', '');
    }

    get wgetUsername(): string {
        return this.getConfig().get<string>('wgetUsername', '');
    }

    get gitPath(): string {
        return this.getConfig().get<string>('gitPath', 'git');
    }

    get gitUsername(): string {
        return this.getConfig().get<string>('gitUsername', '');
    }

    get zohoRepoUsername(): string {
        return this.getConfig().get<string>('zohoRepoUsername', '');
    }

    get customBuildUrl(): string {
        return this.getConfig().get<string>('customBuildUrl', '');
    }

    // Secret storage
    async getWgetPassword(): Promise<string> {
        return (await this.secrets.get(SECRET_WGET_PASSWORD)) || '';
    }

    async setWgetPassword(password: string): Promise<void> {
        await this.secrets.store(SECRET_WGET_PASSWORD, password);
    }

    async getGitPassword(): Promise<string> {
        return (await this.secrets.get(SECRET_GIT_PASSWORD)) || '';
    }

    async setGitPassword(password: string): Promise<void> {
        await this.secrets.store(SECRET_GIT_PASSWORD, password);
    }

    async getZohoRepoPassword(): Promise<string> {
        return (await this.secrets.get(SECRET_ZOHO_REPO_PASSWORD)) || '';
    }

    async setZohoRepoPassword(password: string): Promise<void> {
        await this.secrets.store(SECRET_ZOHO_REPO_PASSWORD, password);
    }
}
