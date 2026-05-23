import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TomcatServer } from '../model/TomcatServer';
import { StateManager } from '../persistence/StateManager';
import { PathResolver } from '../parser/PathResolver';
import { ModuleZidePropsParser } from '../parser/ModuleZidePropsParser';
import { AntResolver } from './AntResolver';

export class ResourceSyncManager {
    private static debounceTimers: Map<string, NodeJS.Timeout> = new Map();

    static async syncFile(document: vscode.TextDocument): Promise<void> {
        const filePath = document.uri.fsPath;

        // Debounce per file path
        const existing = this.debounceTimers.get(filePath);
        if (existing) { clearTimeout(existing); }

        this.debounceTimers.set(filePath, setTimeout(async () => {
            this.debounceTimers.delete(filePath);
            await this.doSync(filePath);
        }, 300));
    }

    private static async doSync(filePath: string): Promise<void> {
        const projectRoot = PathResolver.findProjectRoot(filePath);
        if (!projectRoot) { return; }

        // Find server mapping
        const mapping = StateManager.getInstance().getMappingForProject(projectRoot);
        if (!mapping) { return; }

        const server = StateManager.getInstance().getServer(mapping.serverId);
        if (!server) { return; }
        if (server.status !== 'running') { return; }

        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.java') {
            await this.syncJavaFile(filePath, projectRoot, server);
        } else {
            await this.syncResourceFile(filePath, projectRoot, server);
        }
    }

    private static async syncJavaFile(filePath: string, projectRoot: string, server: TomcatServer): Promise<void> {
        // Find compiled .class file
        const relativePath = path.relative(projectRoot, filePath);
        const classRelPath = relativePath.replace(/\.java$/, '.class').replace(/^src\//, '');

        // Check common output dirs
        const outputDirs = [
            path.join(projectRoot, 'out', 'production'),
            path.join(projectRoot, 'bin'),
            path.join(projectRoot, 'target', 'classes'),
            path.join(projectRoot, 'build', 'classes')
        ];

        let classFile: string | undefined;
        for (const outDir of outputDirs) {
            // Find in subdirectories
            const candidate = this.findClassFile(outDir, classRelPath);
            if (candidate) {
                classFile = candidate;
                break;
            }
        }

        if (!classFile) {
            // Wait briefly for compilation
            await new Promise(resolve => setTimeout(resolve, 1000));
            for (const outDir of outputDirs) {
                const candidate = this.findClassFile(outDir, classRelPath);
                if (candidate) {
                    classFile = candidate;
                    break;
                }
            }
        }

        if (!classFile || !fs.existsSync(classFile)) { return; }

        // Copy to deployment WEB-INF/classes
        const deployClassesDir = path.join(server.deploymentDir, 'WEB-INF', 'classes');
        const destPath = path.join(deployClassesDir, classRelPath);
        const destDir = path.dirname(destPath);

        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        fs.copyFileSync(classFile, destPath);

        // Hot-swap will be triggered by the Java debug extension automatically
        // when java.hotCodeReplace is set to "auto"
    }

    private static async syncResourceFile(filePath: string, projectRoot: string, server: TomcatServer): Promise<void> {
        // Load Zide.properties to check hook tasks and auto-copy
        const propsFile = PathResolver.findZidePropertiesFile(projectRoot);
        if (!propsFile) { return; }

        const moduleProps = ModuleZidePropsParser.parse(propsFile);

        // Check hook tasks
        const hookMappings = ModuleZidePropsParser.getHookMappings(moduleProps.hookTasksRaw);
        const relativePath = path.relative(projectRoot, filePath);

        for (const [pattern, target] of hookMappings) {
            if (this.matchesPattern(relativePath, pattern)) {
                await this.runHookTask(target, projectRoot, server);
                return;
            }
        }

        // Check auto-resource copy
        const copyMappings = ModuleZidePropsParser.getAutoResourceCopyMappings(moduleProps.autoResourceCopyRaw);
        for (const [srcDir, destDir] of copyMappings) {
            const srcFullPath = path.join(projectRoot, srcDir);
            if (PathResolver.isSubPath(srcFullPath, filePath)) {
                const relativeToSrc = path.relative(srcFullPath, filePath);
                const destFullPath = path.join(server.deploymentDir, destDir, relativeToSrc);
                const destDirPath = path.dirname(destFullPath);

                if (!fs.existsSync(destDirPath)) {
                    fs.mkdirSync(destDirPath, { recursive: true });
                }
                fs.copyFileSync(filePath, destFullPath);
                return;
            }
        }
    }

    private static async runHookTask(target: string, projectRoot: string, server: TomcatServer): Promise<void> {
        const antHome = AntResolver.resolveAntHome(server.antHome);
        if (!antHome) { return; }

        // Look for zide_hook build file
        const hookBuildFile = path.join(projectRoot, 'zide_hook.xml');
        if (!fs.existsSync(hookBuildFile)) { return; }

        const result = await AntResolver.runAnt(antHome, hookBuildFile, [target], {
            'project.dir': projectRoot,
            'deployment.dir': server.deploymentDir
        }, projectRoot);

        if (!result.success) {
            vscode.window.showWarningMessage(`ZIDE: Hook task "${target}" failed`);
        }
    }

    private static findClassFile(baseDir: string, classRelPath: string): string | undefined {
        if (!fs.existsSync(baseDir)) { return undefined; }

        // Direct check
        const direct = path.join(baseDir, classRelPath);
        if (fs.existsSync(direct)) { return direct; }

        // Check one level deeper (module name folders)
        try {
            const entries = fs.readdirSync(baseDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const candidate = path.join(baseDir, entry.name, classRelPath);
                    if (fs.existsSync(candidate)) { return candidate; }
                }
            }
        } catch {
            // Ignore
        }

        return undefined;
    }

    private static matchesPattern(filePath: string, pattern: string): boolean {
        // Simple glob matching: * matches any segment, ** matches any path
        const regexStr = pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*');
        const regex = new RegExp(`^${regexStr}$`);
        return regex.test(filePath);
    }
}
