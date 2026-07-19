import { Channel, invoke } from "@tauri-apps/api/core";

export type { AgentDetectInfo } from "./gen/AgentDetectInfo";
export type { AgentIoEvent } from "./gen/AgentIoEvent";
export type { AgentSpawnRequest } from "./gen/AgentSpawnRequest";
export type { AppSettings } from "./gen/AppSettings";
export type { DirEntryInfo } from "./gen/DirEntryInfo";
export type { EnvInfo } from "./gen/EnvInfo";
export type { FileReadResult } from "./gen/FileReadResult";
export type { FileWriteResult } from "./gen/FileWriteResult";
export type { FsEvent } from "./gen/FsEvent";
export type { ProjectInfo } from "./gen/ProjectInfo";
export type { RecentProject } from "./gen/RecentProject";

import type { AgentDetectInfo } from "./gen/AgentDetectInfo";
import type { AgentIoEvent } from "./gen/AgentIoEvent";
import type { AgentSpawnRequest } from "./gen/AgentSpawnRequest";
import type { AppSettings } from "./gen/AppSettings";
import type { DirEntryInfo } from "./gen/DirEntryInfo";
import type { EnvInfo } from "./gen/EnvInfo";
import type { FileReadResult } from "./gen/FileReadResult";
import type { FileWriteResult } from "./gen/FileWriteResult";
import type { FsEvent } from "./gen/FsEvent";
import type { ProjectInfo } from "./gen/ProjectInfo";
import type { RecentProject } from "./gen/RecentProject";

export const ipc = {
  appReady: () => invoke<EnvInfo>("app_ready"),
  perfMark: (name: string) => invoke<void>("perf_mark", { name }),
  projectOpen: (path: string) => invoke<ProjectInfo>("project_open", { path }),
  projectRecent: () => invoke<RecentProject[]>("project_recent"),
  fsList: (path: string) => invoke<DirEntryInfo[]>("fs_list", { path }),
  fsRead: (path: string) => invoke<FileReadResult>("fs_read", { path }),
  fsWrite: (path: string, content: string, expectedHash?: string) =>
    invoke<FileWriteResult>("fs_write", { path, content, expectedHash }),
  fsWatchStart: (path: string, onEvent: (event: FsEvent) => void) => {
    const channel = new Channel<FsEvent>(onEvent);
    return invoke<number>("fs_watch_start", { path, channel });
  },
  fsWatchStop: (watcherId: number) => invoke<void>("fs_watch_stop", { watcherId }),
  settingsGet: () => invoke<AppSettings>("settings_get"),
  settingsSet: (settings: AppSettings) => invoke<void>("settings_set", { settings }),
  agentDetect: () => invoke<AgentDetectInfo[]>("agent_detect"),
  agentSpawn: (request: AgentSpawnRequest, onEvent: (event: AgentIoEvent) => void) => {
    const channel = new Channel<AgentIoEvent>(onEvent);
    return invoke<number>("agent_spawn", { request, channel });
  },
  agentWrite: (sessionId: number, line: string) =>
    invoke<void>("agent_write", { sessionId, line }),
  agentKill: (sessionId: number) => invoke<void>("agent_kill", { sessionId }),
};
