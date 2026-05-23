import * as path from 'path';

export function buildShellCommand(parts: string[]): string {
    return parts.filter(Boolean).join(' && ');
}

export function buildExportEnv(vars: Record<string, string>): string {
    return Object.entries(vars)
        .map(([key, value]) => `export ${key}="${value}"`)
        .join(' && ');
}

export function buildCatalinaCommand(
    catalinaPath: string,
    mode: 'run' | 'jpda run' | 'stop' | 'stop -force',
    envVars: Record<string, string>
): string {
    const exportCmd = buildExportEnv(envVars);
    const chmod = `chmod +x "${catalinaPath}"`;
    const run = `sh "${catalinaPath}" ${mode}`;
    return buildShellCommand([exportCmd, chmod, run]);
}

export function normalizePath(p: string): string {
    return path.normalize(p).replace(/\/+$/, '');
}
