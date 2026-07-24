import { Channel, invoke } from "@tauri-apps/api/core";

export type { AgentDetectInfo } from "./gen/AgentDetectInfo";
export type { AgentCatalogRequest } from "./gen/AgentCatalogRequest";
export type { AgentHarnessCatalog } from "./gen/AgentHarnessCatalog";
export type { AgentIoEvent } from "./gen/AgentIoEvent";
export type { AgentSpawnRequest } from "./gen/AgentSpawnRequest";
export type { AppSettings } from "./gen/AppSettings";
export type { CkptFileContents } from "./gen/CkptFileContents";
export type { CkptFileDiff } from "./gen/CkptFileDiff";
export type { CkptHunkSummary } from "./gen/CkptHunkSummary";
export type { CkptTurnMeta } from "./gen/CkptTurnMeta";
export type { DiffSummary } from "./gen/DiffSummary";
export type { DirEntryInfo } from "./gen/DirEntryInfo";
export type { EnvInfo } from "./gen/EnvInfo";
export type { LaunchRequest } from "./gen/LaunchRequest";
export type { FileReadResult } from "./gen/FileReadResult";
export type { FileWriteResult } from "./gen/FileWriteResult";
export type { FsEvent } from "./gen/FsEvent";
export type { GitFileStatus } from "./gen/GitFileStatus";
export type { GitFileDiff } from "./gen/GitFileDiff";
export type { ProjectInfo } from "./gen/ProjectInfo";
export type { ProviderKind } from "./gen/ProviderKind";
export type { ProviderRecord } from "./gen/ProviderRecord";
export type { ProviderTestResult } from "./gen/ProviderTestResult";
export type { ProviderUsageSnapshot } from "./gen/ProviderUsageSnapshot";
export type { ProviderUpsert } from "./gen/ProviderUpsert";
export type { PtyEvent } from "./gen/PtyEvent";
export type { RecentProject } from "./gen/RecentProject";
export type { RuntimeDetectInfo } from "./gen/RuntimeDetectInfo";
export type { SearchBatch } from "./gen/SearchBatch";
export type { SearchHit } from "./gen/SearchHit";
export type { SessionArchive } from "./gen/SessionArchive";
export type { SessionSummary } from "./gen/SessionSummary";
export type { ToolStatus } from "./gen/ToolStatus";

import type { AgentDetectInfo } from "./gen/AgentDetectInfo";
import type { AgentCatalogRequest } from "./gen/AgentCatalogRequest";
import type { AgentHarnessCatalog } from "./gen/AgentHarnessCatalog";
import type { AgentIoEvent } from "./gen/AgentIoEvent";
import type { AgentSpawnRequest } from "./gen/AgentSpawnRequest";
import type { AppSettings } from "./gen/AppSettings";
import type { CkptFileContents } from "./gen/CkptFileContents";
import type { CkptHunkSummary } from "./gen/CkptHunkSummary";
import type { CkptTurnMeta } from "./gen/CkptTurnMeta";
import type { DirEntryInfo } from "./gen/DirEntryInfo";
import type { EnvInfo } from "./gen/EnvInfo";
import type { LaunchRequest } from "./gen/LaunchRequest";
import type { FileReadResult } from "./gen/FileReadResult";
import type { FileWriteResult } from "./gen/FileWriteResult";
import type { FsEvent } from "./gen/FsEvent";
import type { GitFileStatus } from "./gen/GitFileStatus";
import type { GitFileDiff } from "./gen/GitFileDiff";
import type { ProjectInfo } from "./gen/ProjectInfo";
import type { ProviderRecord } from "./gen/ProviderRecord";
import type { ProviderTestResult } from "./gen/ProviderTestResult";
import type { ProviderUsageSnapshot } from "./gen/ProviderUsageSnapshot";
import type { ProviderUpsert } from "./gen/ProviderUpsert";
import type { PtyEvent } from "./gen/PtyEvent";
import type { RecentProject } from "./gen/RecentProject";
import type { RuntimeDetectInfo } from "./gen/RuntimeDetectInfo";
import type { SearchBatch } from "./gen/SearchBatch";
import type { SessionArchive } from "./gen/SessionArchive";
import type { SessionSummary } from "./gen/SessionSummary";

export const ipc = {
  appReady: () => invoke<EnvInfo>("app_ready"),
  appTakeLaunchRequest: () => invoke<LaunchRequest | null>("app_take_launch_request"),
  perfMark: (name: string) => invoke<void>("perf_mark", { name }),
  windowOpenAgent: () => invoke<void>("window_open_agent"),
  windowFocusMain: () => invoke<void>("window_focus_main"),
  appExit: () => invoke<void>("app_exit"),
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
  agentCatalog: (request: AgentCatalogRequest) =>
    invoke<AgentHarnessCatalog>("agent_catalog", { request }),
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
  providerUsage: (id: string) => invoke<ProviderUsageSnapshot>("provider_usage", { id }),
  gitStatus: (projectPath: string) => invoke<GitFileStatus[]>("git_status", { projectPath }),
  gitExecReadonly: (projectPath: string, args: string[]) =>
    invoke<string>("git_exec_readonly", { projectPath, args }),
  gitDiffFile: (projectPath: string, path: string, base = "HEAD") =>
    invoke<GitFileDiff>("git_diff_file", { projectPath, path, base }),
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
  ckptHunks: (projectPath: string, turnId: string, path: string) =>
    invoke<CkptHunkSummary>("ckpt_hunks", { projectPath, turnId, path }),
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
  agentTermCreate: (request: {
    command: string;
    args?: string[];
    cwd?: string | null;
    env?: Array<{ name: string; value: string }>;
    outputByteLimit?: number | null;
  }) =>
    invoke<string>("agent_term_create", {
      request: {
        command: request.command,
        args: request.args ?? [],
        cwd: request.cwd ?? null,
        env: request.env ?? [],
        outputByteLimit: request.outputByteLimit ?? null,
      },
    }),
  agentTermOutput: (terminalId: string) =>
    invoke<{
      output: string;
      truncated: boolean;
      exitCode: number | null;
      signal: string | null;
    }>("agent_term_output", { terminalId }),
  agentTermWait: (terminalId: string) =>
    invoke<{
      output: string;
      truncated: boolean;
      exitCode: number | null;
      signal: string | null;
    }>("agent_term_wait", { terminalId }),
  agentTermKill: (terminalId: string) => invoke<void>("agent_term_kill", { terminalId }),
  agentTermRelease: (terminalId: string) => invoke<void>("agent_term_release", { terminalId }),
  sessionList: (projectPath: string) =>
    invoke<SessionSummary[]>("session_list", { projectPath }),
  sessionSave: (archive: SessionArchive) =>
    invoke<SessionSummary>("session_save", { archive }),
  sessionLoad: (projectPath: string, id: string) =>
    invoke<SessionArchive>("session_load", { projectPath, id }),
  sessionDelete: (projectPath: string, id: string) =>
    invoke<void>("session_delete", { projectPath, id }),
};
