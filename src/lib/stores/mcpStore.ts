import type { McpServer } from "@agentclientprotocol/sdk";
import { create } from "zustand";

import {
  ipc,
  type McpServerRecord,
  type McpServerUpsert,
} from "@/lib/ipc/ipc";

export function toAcpMcpServers(records: McpServerRecord[]): McpServer[] {
  return records.flatMap((server): McpServer[] => {
    if (!server.enabled) return [];
    if (server.transport === "stdio" && server.command) {
      return [{
        name: server.name,
        command: server.command,
        args: [...server.args],
        env: [],
      }];
    }
    if ((server.transport === "http" || server.transport === "sse") && server.url) {
      return [{
        type: server.transport,
        name: server.name,
        url: server.url,
        headers: [],
      }];
    }
    return [];
  });
}

interface McpState {
  servers: McpServerRecord[];
  loading: boolean;
  saving: boolean;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<McpServerRecord[]>;
  upsert: (server: McpServerUpsert) => Promise<McpServerRecord | null>;
  remove: (id: string) => Promise<boolean>;
  setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  enabledForSession: () => Promise<McpServer[]>;
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  loading: false,
  saving: false,
  loaded: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const servers = await ipc.mcpServersList();
      set({ servers, loading: false, loaded: true });
      return servers;
    } catch (error) {
      set({
        loading: false,
        loaded: true,
        error: error instanceof Error ? error.message : String(error),
      });
      return get().servers;
    }
  },

  upsert: async (server) => {
    set({ saving: true, error: null });
    try {
      const record = await ipc.mcpServersUpsert(server);
      const servers = await ipc.mcpServersList();
      set({ servers, saving: false, loaded: true });
      return record;
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },

  remove: async (id) => {
    set({ saving: true, error: null });
    try {
      await ipc.mcpServersRemove(id);
      set((state) => ({
        servers: state.servers.filter((server) => server.id !== id),
        saving: false,
      }));
      return true;
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  },

  setEnabled: async (id, enabled) => {
    const server = get().servers.find((entry) => entry.id === id);
    if (!server) return false;
    return Boolean(await get().upsert({
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      url: server.url,
      enabled,
    }));
  },

  enabledForSession: async () => {
    const servers = get().loaded ? get().servers : await get().refresh();
    const error = get().error;
    if (error) throw new Error(error);
    return toAcpMcpServers(servers);
  },
}));
