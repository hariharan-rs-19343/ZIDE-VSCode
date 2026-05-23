import * as https from 'https';
import { SettingsManager } from '../settings/SettingsManager';

const BASE_URL = 'https://cmtools.csez.zohocorpin.com/api/v1';
const TIMEOUT_MS = 30000;

export interface CmToolProduct {
    id: number;
    name: string;
    repositoryUrl: string;
    downloadUrl: string;
    serviceName: string;
}

export class CmToolApiClient {
    static async fetchServices(): Promise<CmToolProduct[]> {
        const settings = SettingsManager.getInstance();
        await settings.ensureSecretsLoaded();
        const token = settings.cmToolAuthToken;
        if (!token) {
            throw new Error('CMTool auth token not configured. Open ZIDE Settings to configure it.');
        }

        const url = `${BASE_URL}/products?personal=true&include_role_acccess=true`;

        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const req = https.request(
                {
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    method: 'GET',
                    headers: {
                        'PRIVATE-TOKEN': token,
                        'Accept': 'application/json'
                    },
                    timeout: TIMEOUT_MS
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        if (res.statusCode !== 200) {
                            reject(new Error(`CMTool API returned ${res.statusCode}: ${data}`));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            // Handle various API response shapes
                            let items: Record<string, unknown>[];
                            if (Array.isArray(parsed)) {
                                items = parsed;
                            } else if (Array.isArray(parsed.data)) {
                                items = parsed.data;
                            } else if (parsed.data && Array.isArray(parsed.data.products)) {
                                items = parsed.data.products;
                            } else if (Array.isArray(parsed.products)) {
                                items = parsed.products;
                            } else if (parsed.data && Array.isArray(parsed.data.items)) {
                                items = parsed.data.items;
                            } else {
                                reject(new Error(`Unexpected CMTool response structure: ${JSON.stringify(parsed).substring(0, 200)}`));
                                return;
                            }
                            const products: CmToolProduct[] = items.map((item) => ({
                                id: item.id as number,
                                name: (item.name || item.product_name || '') as string,
                                repositoryUrl: (item.repository_url || item.repo_url || '') as string,
                                downloadUrl: (item.download_url || item.build_url || '') as string,
                                serviceName: (item.service_name || item.name || '') as string
                            }));
                            resolve(products);
                        } catch (e) {
                            reject(new Error(`Failed to parse CMTool response: ${e}`));
                        }
                    });
                }
            );

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('CMTool API request timed out (30s)'));
            });

            req.on('error', (e) => {
                reject(new Error(`CMTool API request failed: ${e.message}`));
            });

            req.end();
        });
    }
}
