import * as https from 'https';
import { SettingsManager } from '../settings/SettingsManager';

const BASE_URL = 'https://cmtools.csez.zohocorpin.com/api/v1';
const TIMEOUT_MS = 10000;

export interface CmToolProduct {
    id: number;
    name: string;
    repositoryUrl: string;
    downloadUrl: string;
    serviceName: string;
}

export class CmToolApiClient {
    static async fetchServices(): Promise<CmToolProduct[]> {
        const token = SettingsManager.getInstance().cmToolAuthToken;
        if (!token) {
            throw new Error('CMTool auth token not configured. Set zide.cmToolAuthToken in settings.');
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
                            const products: CmToolProduct[] = (parsed.data || parsed || []).map((item: Record<string, unknown>) => ({
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
                reject(new Error('CMTool API request timed out (10s)'));
            });

            req.on('error', (e) => {
                reject(new Error(`CMTool API request failed: ${e.message}`));
            });

            req.end();
        });
    }
}
