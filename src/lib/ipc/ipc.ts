import { Channel, invoke } from "@tauri-apps/api/core";

export type { AgentDetectInfo } from "./gen/AgentDetectInfo";
export type { AgentIoEvent } from "./gen/AgentIoEvent";
export type { AgentSpawnRequest } from "./gen/AgentSpawnRequest";
export type { AppSettings } from "./gen/AppSettings";
export type { CkptFileContents } from "./gen/CkptFileContents";
export type { CkptFileDiff } from "./gen/CkptFileDiff";
export type { CkptTurnMeta } from "./gen/CkptTurnMeta";
export type { DirEntryInfo } from "./gen/DirEntryInfo";
export type { EnvInfo } from "./gen/EnvInfo";
export type { FileReadResult } from "./gen/FileReadResult";
export type { FileWriteResult } from "./gen/FileWriteResult";
export type { FsEvent } from "./gen/FsEvent";
export type { GitFileStatus } from "./gen/GitFileStatus";
export type { ProjectInfo } from "./gen/ProjectInfo";
export type { ProviderKind } from "./gen/ProviderKind";
export type { ProviderRecord } from "./gen/ProviderRecord";
export type { ProviderTestResult } from "./gen/ProviderTestResult";
export type { ProviderUpsert } from "./gen/ProviderUpsert";
export type { PtyEvent } from "./gen/PtyEvent";
export type { RecentProject } from "./gen/RecentProject";
export type { RuntimeDetectInfo } from "./gen/RuntimeDetectInfo";
export type { SearchBatch } from "./gen/SearchBatch";
export type { SearchHit } from "./gen/SearchHit";
export type { ToolStatus } from "./gen/ToolStatus";

import type { AgentDetectInfo } from "./gen/AgentDetectInfo";
import type { AgentIoEvent } from "./gen/AgentIoEvent";
import type { AgentSpawnRequest } from "./gen/AgentSpawnRequest";
import type { AppSettings } from "./gen/AppSettings";
import type { CkptFileContents } from "./gen/CkptFileContents";
import type { CkptTurnMeta } from "./gen/CkptTurnMeta";
import type { DirEntryInfo } from "./gen/DirEntryInfo";
import type { EnvInfo } from "./gen/EnvInfo";
import type { FileReadResult } from "./gen/FileReadResult";
import type { FileWriteResult } from "./gen/FileWriteResult";
import type { FsEvent } from "./gen/FsEvent";
import type { GitFileStatus } from "./gen/GitFileStatus";
import type { ProjectInfo } from "./gen/ProjectInfo";
import type { ProviderRecord } from "./gen/ProviderRecord";
import type { ProviderTestResult } from "./gen/ProviderTestResult";
import type { ProviderUpsert } from "./gen/ProviderUpsert";
import type { PtyEvent } from "./gen/PtyEvent";
import type { RecentProject } from "./gen/RecentProject";
import type { RuntimeDetectInfo } from "./gen/RuntimeDetectInfo";
import type { SearchBatch } from "./gen/SearchBatch";

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
  gitStatus: (projectPath: string) => invoke<GitFileStatus[]>("git_status", { projectPath }),
  gitExecReadonly: (projectPath: string, args: string[]) =>
    invoke<string>("git_exec_readonly", { projectPath, args }),
  ckptBeginTurn: (projectPath: string, label?: string) =>
    invoke<CkptTurnMeta>("ckpt_begin_turn", { projectPath, label }),
  ckptPreimage: (projectPath: string, path: string) =>
    invoke<void>("ckpt_preimage", { projectPath, path }),
  ckptCommitTurn: (projectPath: string, turnId?: string | null) =>
    invoke<CkptTurnMeta>("ckpt_commit_turn", { projectPath, turnId: turnId ?? null }),
  ckptListTurns: (projectPath: string) =>
    invoke<CkptTurnMeta[]>("ckpt_list_turns", { projectPath }),
  ckptFileContents: (projectPath: string, turnId: string, path: string) =>
    invoke<CkptFileContents>("ckpt_file_contents", { projectPath, turnId, path }),
  ckptRestoreTurn: (projectPath: string, turnId: string) =>
    invoke<CkptTurnMeta>("ckpt_restore_turn", { projectPath, turnId }),
  ckptRestoreFile: (projectPath: string, turnId: string, path: string) =>
    invoke<void>("ckpt_restore_file", { projectPath, turnId, path }),
  ckptWriteFile: (projectPath: string, path: string, content: string) =>
    invoke<void>("ckpt_write_file", { projectPath, path, content }),
  searchStart: (root: string, query: string, onBatch: (batch: SearchBatch) => void) => {
    const channel = new Channel<SearchBatch>(onBatch);
    return invoke<number>("search_start", { root, query, channel });
  },
  searchCancel: (searchId: number) => invoke<void>("search_cancel", { searchId }),
  ptyOpen: (
    cwd: string,
    cols: number,
    rows: number,
    onEvent: (event: PtyEvent) => void,
  ) => {
    const channel = new Channel<PtyEvent>(onEvent);
    return invoke<number>("pty_open", { cwd, cols, rows, channel });
  },
  ptyWrite: (ptyId: number, data: string) => invoke<void>("pty_write", { ptyId, data }),
  ptyResize: (ptyId: number, cols: number, rows: number) =>
    invoke<void>("pty_resize", { ptyId, cols, rows }),
  ptyClose: (ptyId: number) => invoke<void>("pty_close", { ptyId }),
};
