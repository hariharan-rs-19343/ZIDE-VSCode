import * as path from 'path';
import * as fs from 'fs';
import { runCommand } from '../util/processUtil';

export class AntResolver {
    static resolveAntHome(serverAntHome?: string): string | undefined {
        // Priority: server config > env > common locations
        if (serverAntHome && fs.existsSync(serverAntHome)) {
            return serverAntHome;
        }

        const envAntHome = process.env['ANT_HOME'];
        if (envAntHome && fs.existsSync(envAntHome)) {
            return envAntHome;
        }

        // Common locations
        const commonPaths = [
            '/usr/local/opt/ant/libexec',
            '/usr/local/ant',
            '/opt/homebrew/opt/ant/libexec',
            path.join(process.env['HOME'] || '', '.ant')
        ];

        for (const p of commonPaths) {
            if (fs.existsSync(path.join(p, 'bin', 'ant'))) {
                return p;
            }
        }

        return undefined;
    }

    static buildAntCommand(
        antHome: string,
        buildFile: string,
        targets: string[],
        properties: Record<string, string> = {}
    ): string {
        const antBin = path.join(antHome, 'bin', 'ant');
        const propsStr = Object.entries(properties)
            .map(([k, v]) => `-D${k}="${v}"`)
            .join(' ');
        const targetsStr = targets.join(' ');
        return `"${antBin}" -f "${buildFile}" ${propsStr} ${targetsStr}`.trim();
    }

    static async runAnt(
        antHome: string,
        buildFile: string,
        targets: string[],
        properties: Record<string, string> = {},
        cwd?: string
    ): Promise<{ success: boolean; output: string }> {
        const command = this.buildAntCommand(antHome, buildFile, targets, properties);
        const result = await runCommand(command, cwd);
        return {
            success: result.exitCode === 0,
            output: result.stdout + result.stderr
        };
    }
}
