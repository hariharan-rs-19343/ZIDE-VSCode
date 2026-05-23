import * as path from 'path';
import * as fs from 'fs';

export class PathResolver {
    static findProjectRoot(filePath: string): string | undefined {
        let current = path.dirname(filePath);
        const root = path.parse(current).root;

        while (current !== root) {
            const serviceXml = path.join(current, '.zide_resources', 'service.xml');
            if (fs.existsSync(serviceXml)) {
                return current;
            }
            current = path.dirname(current);
        }
        return undefined;
    }

    static isSubPath(parent: string, child: string): boolean {
        const relative = path.relative(parent, child);
        return !relative.startsWith('..') && !path.isAbsolute(relative);
    }

    static normalizePath(p: string): string {
        return path.normalize(p).replace(/\/+$/, '');
    }

    static resolveZideResourcesPath(projectRoot: string): string | undefined {
        const candidates = [
            path.join(projectRoot, '.zide_resources'),
            path.join(projectRoot, '.antsetup', 'hg_utils', '.zide_resources'),
            path.join(projectRoot, 'zide', '.zide_resources')
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        // Check sibling directories
        const parent = path.dirname(projectRoot);
        if (fs.existsSync(parent)) {
            const siblings = fs.readdirSync(parent);
            for (const sibling of siblings) {
                const siblingZide = path.join(parent, sibling, '.zide_resources');
                if (fs.existsSync(siblingZide)) {
                    return siblingZide;
                }
            }
        }

        return undefined;
    }

    static readRepositoryPath(projectPath: string): string | undefined {
        const repoPropsFile = path.join(projectPath, '.zide_resources', 'repository.properties');
        if (fs.existsSync(repoPropsFile)) {
            const content = fs.readFileSync(repoPropsFile, 'utf-8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (trimmed.startsWith('repositorypath=')) {
                    const value = trimmed.substring('repositorypath='.length).trim();
                    if (value) { return value; }
                }
            }
        }
        const zideResources = path.join(projectPath, '.zide_resources');
        if (fs.existsSync(zideResources)) {
            return path.resolve(path.dirname(zideResources));
        }
        return undefined;
    }

    static findZidePropertiesFile(projectRoot: string): string | undefined {
        const candidates = [
            path.join(projectRoot, 'Zide.properties'),
            path.join(projectRoot, 'zide.properties')
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }
}
