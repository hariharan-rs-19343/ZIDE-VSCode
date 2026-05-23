import * as vscode from 'vscode';
import { TomcatServer } from '../model/TomcatServer';
import { ProjectServerMapping } from '../model/ProjectServerMapping';
import { normalizePath } from '../util/shellUtil';

const SERVERS_KEY = 'zide.servers';
const MAPPINGS_KEY = 'zide.mappings';

export class StateManager {
    private static instance: StateManager;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    static initialize(context: vscode.ExtensionContext): StateManager {
        StateManager.instance = new StateManager(context);
        return StateManager.instance;
    }

    static getInstance(): StateManager {
        if (!StateManager.instance) {
            throw new Error('StateManager not initialized');
        }
        return StateManager.instance;
    }

    // Server CRUD
    getServers(): TomcatServer[] {
        return this.context.globalState.get<TomcatServer[]>(SERVERS_KEY, []);
    }

    getServer(id: string): TomcatServer | undefined {
        return this.getServers().find(s => s.id === id);
    }

    async addServer(server: TomcatServer): Promise<void> {
        const servers = this.getServers();
        server.path = normalizePath(server.path);
        servers.push(server);
        await this.context.globalState.update(SERVERS_KEY, servers);
    }

    async updateServer(server: TomcatServer): Promise<void> {
        const servers = this.getServers();
        const index = servers.findIndex(s => s.id === server.id);
        if (index >= 0) {
            server.path = normalizePath(server.path);
            servers[index] = server;
            await this.context.globalState.update(SERVERS_KEY, servers);
        }
    }

    async removeServer(id: string): Promise<void> {
        const servers = this.getServers().filter(s => s.id !== id);
        await this.context.globalState.update(SERVERS_KEY, servers);
        // Also remove associated mappings
        const mappings = this.getMappings().filter(m => m.serverId !== id);
        await this.context.globalState.update(MAPPINGS_KEY, mappings);
    }

    async updateServerStatus(id: string, status: TomcatServer['status']): Promise<void> {
        const server = this.getServer(id);
        if (server) {
            server.status = status;
            await this.updateServer(server);
        }
    }

    // Mapping CRUD
    getMappings(): ProjectServerMapping[] {
        return this.context.globalState.get<ProjectServerMapping[]>(MAPPINGS_KEY, []);
    }

    getMappingForProject(projectPath: string): ProjectServerMapping | undefined {
        const normalized = normalizePath(projectPath);
        return this.getMappings().find(m => normalizePath(m.projectPath) === normalized);
    }

    getMappingsForServer(serverId: string): ProjectServerMapping[] {
        return this.getMappings().filter(m => m.serverId === serverId);
    }

    async addMapping(mapping: ProjectServerMapping): Promise<void> {
        const mappings = this.getMappings();
        mapping.projectPath = normalizePath(mapping.projectPath);
        // Replace existing mapping for same project
        const index = mappings.findIndex(m => normalizePath(m.projectPath) === mapping.projectPath);
        if (index >= 0) {
            mappings[index] = mapping;
        } else {
            mappings.push(mapping);
        }
        await this.context.globalState.update(MAPPINGS_KEY, mappings);
    }

    async removeMapping(projectPath: string): Promise<void> {
        const normalized = normalizePath(projectPath);
        const mappings = this.getMappings().filter(m => normalizePath(m.projectPath) !== normalized);
        await this.context.globalState.update(MAPPINGS_KEY, mappings);
    }
}
