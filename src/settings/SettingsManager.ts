import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { SETTING_KEYS } from './settingKeys';

export class SettingsManager {
    private static instance: SettingsManager;
    private context: vscode.ExtensionContext | undefined;
    private resolvedGitPath: string | undefined;
    private secretCache: Map<string, string> = new Map();
    private secretsLoaded = false;

    private constructor() {}

    static initialize(context?: vscode.ExtensionContext): SettingsManager {
        SettingsManager.instance = new SettingsManager();
        SettingsManager.instance.context = context;
        if (context) {
            SettingsManager.instance.preloadSecrets();
        }
        return SettingsManager.instance;
    }

    static getInstance(): SettingsManager {
        if (!SettingsManager.instance) {
            throw new Error('SettingsManager not initialized');
        }
        return SettingsManager.instance;
    }

    private async preloadSecrets(): Promise<void> {
        if (!this.context) { return; }
        const secretKeys = [
            SETTING_KEYS.cmToolAuthToken,
            SETTING_KEYS.gitPassword,
            SETTING_KEYS.wgetPassword,
            SETTING_KEYS.zohoRepoPassword
        ];
        await Promise.all(secretKeys.map(async (key) => {
            const val = await this.context!.secrets.get(key);
            if (val !== undefined) { this.secretCache.set(key, val); }
        }));
        this.secretsLoaded = true;
    }

    async ensureSecretsLoaded(): Promise<void> {
        if (!this.secretsLoaded) {
            await this.preloadSecrets();
        }
    }

    get cmToolAuthToken(): string {
        return this.secretCache.get(SETTING_KEYS.cmToolAuthToken)
            || this.getLegacyConfig('cmToolAuthToken');
    }

    async getCmToolAuthTokenAsync(): Promise<string> {
        const val = await this.context?.secrets.get(SETTING_KEYS.cmToolAuthToken);
        return val || this.getLegacyConfig('cmToolAuthToken');
    }

    get gitPath(): string {
        const stored = this.getState(SETTING_KEYS.gitPath)
            || this.getLegacyConfig('gitPath');
        if (stored) { return stored; }
        if (!this.resolvedGitPath) {
            try {
                this.resolvedGitPath = execSync('which git', { encoding: 'utf-8' }).trim();
            } catch {
                this.resolvedGitPath = 'git';
            }
        }
        return this.resolvedGitPath;
    }

    get gitUsername(): string {
        return this.getState(SETTING_KEYS.gitUsername)
            || this.getLegacyConfig('gitUsername');
    }

    get gitPassword(): string {
        return this.secretCache.get(SETTING_KEYS.gitPassword)
            || this.getLegacyConfig('gitPassword');
    }

    get wgetUsername(): string {
        return this.getState(SETTING_KEYS.wgetUsername)
            || this.getLegacyConfig('wgetUsername');
    }

    get wgetPassword(): string {
        return this.secretCache.get(SETTING_KEYS.wgetPassword)
            || this.getLegacyConfig('wgetPassword');
    }

    get zohoRepoUsername(): string {
        return this.getState(SETTING_KEYS.zohoRepoUsername)
            || this.getLegacyConfig('zohoRepoUsername');
    }

    get zohoRepoPassword(): string {
        return this.secretCache.get(SETTING_KEYS.zohoRepoPassword)
            || this.getLegacyConfig('zohoRepoPassword');
    }

    private getLegacyConfig(key: string): string {
        return vscode.workspace.getConfiguration('zide').get<string>(key, '');
    }

    private getState(key: string): string {
        return this.context?.globalState.get<string>(key, '') || '';
    }
}
