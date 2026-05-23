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
}
