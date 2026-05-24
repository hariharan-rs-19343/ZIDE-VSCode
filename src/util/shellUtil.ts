import * as path from 'path';
import { execFile } from 'child_process';

export interface ScriptResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export function buildShellCommand(parts: string[]): string {
    return parts.filter(Boolean).join(' && ');
}

export function buildExportEnv(vars: Record<string, string>): string {
    return Object.entries(vars)
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([key, value]) => {
            // Use single quotes (matching IntelliJ) to avoid issues with
            // setenv.sh that uses unquoted $CATALINA_OPTS in test expressions
            const escaped = value.replace(/'/g, "'\\''");
            return `export ${key}='${escaped}'`;
        })
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

/**
 * Run a shell script with arguments and optional environment variables.
 * Returns stdout, stderr, and exit code.
 */
export function runScript(
    scriptPath: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string> }
): Promise<ScriptResult> {
    return new Promise((resolve) => {
        const env = { ...process.env, ...(options.env || {}) };
        const child = execFile('sh', [scriptPath, ...args], {
            cwd: options.cwd,
            env,
            timeout: 30000
        }, (error, stdout, stderr) => {
            resolve({
                stdout: stdout || '',
                stderr: stderr || '',
                exitCode: error ? (error as any).code ?? 1 : 0
            });
        });
    });
}
