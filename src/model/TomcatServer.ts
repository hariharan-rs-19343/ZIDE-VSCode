export type ServerStatus = 'running' | 'stopped' | 'starting' | 'stopping';
export type ServerMode = 'run' | 'debug';

export interface TomcatServer {
    id: string;
    name: string;
    path: string;
    status: ServerStatus;
    port: number;
    debugPort: number;
    shutdownPort: number;
    contextPath: string;
    deploymentDir: string;
    zideResourcesPath: string;
    zidePropertiesPath: string;
    serviceName: string;
    antHome: string;
    javaHome: string;
    vmArguments: string;
    lastMode?: ServerMode;
    /** Description for display */
    description?: string;
    /** ZIDE service key for this server */
    zideServiceKey?: string;
    /** Path to the zide folder (sibling of project) */
    zideFolderPath?: string;
    /** Raw launch.vmarguments from Zide.properties (before substitution) */
    zideLaunchVmArguments?: string;
    /** ZIDE.REPOSITORY_MODULE_DIR from service.xml */
    repositoryModuleDir?: string;
    /** Deploy type (e.g. 'M19') */
    deployType?: string;
    /** All runtime properties merged from service.xml + zide_properties.xml */
    zideRuntimeProperties?: Record<string, string>;
    /** Whether to deploy a configured WAR on run/debug */
    deployConfiguredWarOnRun?: boolean;
    /** Path to the configured WAR file for auto-deployment */
    configuredWarFilePath?: string;
}
