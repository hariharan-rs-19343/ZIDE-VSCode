import { exec, spawn, ChildProcess, SpawnOptions } from 'child_process';

export interface ProcessResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

export function runCommand(command: string, cwd?: string): Promise<ProcessResult> {
    return new Promise((resolve) => {
        exec(command, { cwd, shell: '/bin/sh', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({
                stdout: stdout || '',
                stderr: stderr || '',
                exitCode: error ? error.code ?? 1 : 0
            });
        });
    });
}

export function spawnProcess(
    command: string,
    args: string[],
    options?: SpawnOptions
): ChildProcess {
    return spawn(command, args, {
        shell: '/bin/sh',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options
    });
}

export function spawnShell(
    shellCommand: string,
    cwd?: string
): ChildProcess {
    return spawn('sh', ['-c', shellCommand], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

export async function killProcess(pid: number): Promise<void> {
    try {
        process.kill(pid, 'SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
            process.kill(pid, 0);
            process.kill(pid, 'SIGKILL');
        } catch {
            // Process already dead
        }
    } catch {
        // Process not found
    }
}

export async function findProcessOnPort(port: number): Promise<number | null> {
    const result = await runCommand(`lsof -ti :${port}`);
    if (result.exitCode === 0 && result.stdout.trim()) {
        const pid = parseInt(result.stdout.trim().split('\n')[0], 10);
        return isNaN(pid) ? null : pid;
    }
    return null;
}
