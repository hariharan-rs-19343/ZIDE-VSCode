import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

export interface ZideService {
    name: string;
    properties: Record<string, string>;
}

export interface ZideEnvironmentProps {
    [key: string]: string;
}

interface CacheEntry<T> {
    data: T;
    mtime: number;
}

export class ZideConfigParser {
    private static serviceCache: Map<string, CacheEntry<ZideService[]>> = new Map();
    private static propsCache: Map<string, CacheEntry<ZideEnvironmentProps>> = new Map();

    private static parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        // XXE protection: disable external entity processing
        processEntities: false,
        htmlEntities: false
    });

    static parseServiceXml(filePath: string): ZideService[] {
        const cached = this.getCached(this.serviceCache, filePath);
        if (cached) { return cached; }

        if (!fs.existsSync(filePath)) { return []; }

        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = this.parser.parse(content);

        const services: ZideService[] = [];
        const root = parsed.services || parsed.service || parsed;
        let serviceNodes = root?.service || root?.services?.service;

        if (!serviceNodes) { return []; }
        if (!Array.isArray(serviceNodes)) { serviceNodes = [serviceNodes]; }

        for (const node of serviceNodes) {
            const service: ZideService = {
                name: node['@_name'] || node.name || '',
                properties: {}
            };

            let propNodes = node.property || node.properties?.property;
            if (propNodes) {
                if (!Array.isArray(propNodes)) { propNodes = [propNodes]; }
                for (const prop of propNodes) {
                    const key = prop['@_name'] || prop['@_key'] || '';
                    const value = prop['@_value'] || prop['#text'] || '';
                    if (key) { service.properties[key] = value; }
                }
            }

            services.push(service);
        }

        this.setCache(this.serviceCache, filePath, services);
        return services;
    }

    static parseZidePropertiesXml(filePath: string): ZideEnvironmentProps {
        const cached = this.getCached(this.propsCache, filePath);
        if (cached) { return cached; }

        if (!fs.existsSync(filePath)) { return {}; }

        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = this.parser.parse(content);

        const props: ZideEnvironmentProps = {};
        const root = parsed.properties || parsed.zide_properties || parsed;
        let propNodes = root?.property || root?.entry;

        if (!propNodes) { return props; }
        if (!Array.isArray(propNodes)) { propNodes = [propNodes]; }

        for (const prop of propNodes) {
            const key = prop['@_name'] || prop['@_key'] || '';
            const value = prop['@_value'] || prop['#text'] || '';
            if (key) { props[key] = value; }
        }

        this.setCache(this.propsCache, filePath, props);
        return props;
    }

    static clearCache(): void {
        this.serviceCache.clear();
        this.propsCache.clear();
    }

    private static getCached<T>(cache: Map<string, CacheEntry<T>>, filePath: string): T | undefined {
        const entry = cache.get(filePath);
        if (!entry) { return undefined; }

        try {
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs === entry.mtime) {
                return entry.data;
            }
        } catch {
            // File no longer exists
        }

        cache.delete(filePath);
        return undefined;
    }

    private static setCache<T>(cache: Map<string, CacheEntry<T>>, filePath: string, data: T): void {
        try {
            const stat = fs.statSync(filePath);
            cache.set(filePath, { data, mtime: stat.mtimeMs });
        } catch {
            // Ignore
        }
    }
}
