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
export type { ProviderKind } from "./gen/ProviderKind";
export type { ProviderRecord } from "./gen/ProviderRecord";
export type { ProviderTestResult } from "./gen/ProviderTestResult";
export type { ProviderUpsert } from "./gen/ProviderUpsert";
export type { RecentProject } from "./gen/RecentProject";
export type { RuntimeDetectInfo } from "./gen/RuntimeDetectInfo";
export type { SessionArchive } from "./gen/SessionArchive";
export type { SessionSummary } from "./gen/SessionSummary";
export type { ToolStatus } from "./gen/ToolStatus";

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
import type { ProviderRecord } from "./gen/ProviderRecord";
import type { ProviderTestResult } from "./gen/ProviderTestResult";
import type { ProviderUpsert } from "./gen/ProviderUpsert";
import type { RecentProject } from "./gen/RecentProject";
import type { RuntimeDetectInfo } from "./gen/RuntimeDetectInfo";
import type { SessionArchive } from "./gen/SessionArchive";
import type { SessionSummary } from "./gen/SessionSummary";

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
  runtimeDetect: () => invoke<RuntimeDetectInfo>("runtime_detect"),
  agentSpawn: (request: AgentSpawnRequest, onEvent: (event: AgentIoEvent) => void) => {
    const channel = new Channel<AgentIoEvent>(onEvent);
    return invoke<number>("agent_spawn", { request, channel });
  },
  agentWrite: (sessionId: number, line: string) =>
    invoke<void>("agent_write", { sessionId, line }),
  agentKill: (sessionId: number) => invoke<void>("agent_kill", { sessionId }),
  providersList: () => invoke<ProviderRecord[]>("providers_list"),
  providersUpsert: (provider: ProviderUpsert) =>
    invoke<ProviderRecord>("providers_upsert", { provider }),
  providersRemove: (id: string) => invoke<void>("providers_remove", { id }),
  vaultProbe: (id: string) => invoke<boolean>("vault_probe", { id }),
  vaultClear: (id: string) => invoke<void>("vault_clear", { id }),
  providerTest: (id: string) => invoke<ProviderTestResult>("provider_test", { id }),
  sessionList: (projectPath: string) =>
    invoke<SessionSummary[]>("session_list", { projectPath }),
  sessionSave: (archive: SessionArchive) =>
    invoke<SessionSummary>("session_save", { archive }),
  sessionLoad: (projectPath: string, id: string) =>
    invoke<SessionArchive>("session_load", { projectPath, id }),
  sessionDelete: (projectPath: string, id: string) =>
    invoke<void>("session_delete", { projectPath, id }),
};
