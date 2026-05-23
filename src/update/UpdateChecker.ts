import * as vscode from 'vscode';
import * as https from 'https';

const GITHUB_API_URL = 'https://api.github.com/repos/hariharan-rs-19343/ZIDE-Server/releases/latest';

interface UpdateInfo {
    currentVersion: string;
    latestVersion: string;
    downloadUrl: string;
    releaseNotes: string;
}

export class UpdateChecker {
    static async checkOnActivation(context: vscode.ExtensionContext): Promise<void> {
        try {
            const updateInfo = await this.checkForUpdate(context);
            if (updateInfo) {
                this.showUpdateNotification(updateInfo);
            }
        } catch {
            // Silently ignore update check failures on startup
        }
    }

    static async checkManually(context: vscode.ExtensionContext): Promise<void> {
        const updateInfo = await this.checkForUpdate(context);
        if (updateInfo) {
            this.showUpdateNotification(updateInfo);
        } else {
            const currentVersion = this.getCurrentVersion(context);
            vscode.window.showInformationMessage(`ZIDE is up to date (v${currentVersion}).`);
        }
    }

    private static getCurrentVersion(context: vscode.ExtensionContext): string {
        return context.extension.packageJSON.version || '0.0.0';
    }

    private static async checkForUpdate(context: vscode.ExtensionContext): Promise<UpdateInfo | null> {
        return new Promise((resolve) => {
            const req = https.request(
                {
                    hostname: 'api.github.com',
                    path: '/repos/hariharan-rs-19343/ZIDE-Server/releases/latest',
                    method: 'GET',
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'ZIDE-VSCode-Extension'
                    },
                    timeout: 10000
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        if (res.statusCode !== 200) {
                            resolve(null);
                            return;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            const tagName = parsed.tag_name as string;
                            if (!tagName) { resolve(null); return; }

                            const latestVersion = tagName.replace(/^[vV]/, '');
                            const currentVersion = this.getCurrentVersion(context);

                            if (!this.isNewerVersion(latestVersion, currentVersion)) {
                                resolve(null);
                                return;
                            }

                            let downloadUrl = '';
                            const assets = parsed.assets as Array<{ browser_download_url: string; name: string }>;
                            if (assets) {
                                const vsix = assets.find(a => a.name.endsWith('.vsix'));
                                const zip = assets.find(a => a.name.endsWith('.zip'));
                                downloadUrl = vsix?.browser_download_url || zip?.browser_download_url || '';
                            }

                            resolve({
                                currentVersion,
                                latestVersion,
                                downloadUrl,
                                releaseNotes: (parsed.body as string) || ''
                            });
                        } catch {
                            resolve(null);
                        }
                    });
                }
            );

            req.on('timeout', () => { req.destroy(); resolve(null); });
            req.on('error', () => { resolve(null); });
            req.end();
        });
    }

    private static showUpdateNotification(updateInfo: UpdateInfo): void {
        const message = `ZIDE v${updateInfo.latestVersion} is available (current: v${updateInfo.currentVersion}).`;
        const actions = updateInfo.downloadUrl ? ['Download', 'Later'] : ['Later'];

        vscode.window.showInformationMessage(message, ...actions).then((action) => {
            if (action === 'Download' && updateInfo.downloadUrl) {
                vscode.env.openExternal(vscode.Uri.parse(updateInfo.downloadUrl));
            }
        });
    }

    private static isNewerVersion(latest: string, current: string): boolean {
        const latestParts = latest.split('.').map(p => parseInt(p, 10) || 0);
        const currentParts = current.split('.').map(p => parseInt(p, 10) || 0);

        for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
            const l = latestParts[i] || 0;
            const c = currentParts[i] || 0;
            if (l > c) { return true; }
            if (l < c) { return false; }
        }
        return false;
    }
}
