import * as fs from 'fs';

export interface ModuleZideProps {
    launchVmArguments: string;
    hookTasksRaw: string;
    autoResourceCopyRaw: string;
    properties: Record<string, string>;
}

export class ModuleZidePropsParser {
    static parse(filePath: string): ModuleZideProps {
        if (!fs.existsSync(filePath)) {
            return { launchVmArguments: '', hookTasksRaw: '', autoResourceCopyRaw: '', properties: {} };
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const properties: Record<string, string> = {};

        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) { continue; }

            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
                const key = trimmed.substring(0, eqIndex).trim();
                const value = trimmed.substring(eqIndex + 1).trim();
                properties[key] = value;
            }
        }

        return {
            launchVmArguments: properties['launch.vmarguments'] || '',
            hookTasksRaw: properties['hooks.resourcemodify.all.calltasks'] || '',
            autoResourceCopyRaw: properties['deploy.autoresource.copy'] || '',
            properties
        };
    }

    static getHookMappings(hookTasksRaw: string): Map<string, string> {
        const mappings = new Map<string, string>();
        if (!hookTasksRaw) { return mappings; }

        // Format: "pattern1:target1,pattern2:target2"
        const pairs = hookTasksRaw.split(',');
        for (const pair of pairs) {
            const parts = pair.trim().split(':');
            if (parts.length === 2) {
                mappings.set(parts[0].trim(), parts[1].trim());
            }
        }
        return mappings;
    }

    static getAutoResourceCopyMappings(autoResourceCopyRaw: string): Map<string, string> {
        const mappings = new Map<string, string>();
        if (!autoResourceCopyRaw) { return mappings; }

        // Format: "srcDir1:destDir1,srcDir2:destDir2"
        const pairs = autoResourceCopyRaw.split(',');
        for (const pair of pairs) {
            const parts = pair.trim().split(':');
            if (parts.length === 2) {
                mappings.set(parts[0].trim(), parts[1].trim());
            }
        }
        return mappings;
    }
}
