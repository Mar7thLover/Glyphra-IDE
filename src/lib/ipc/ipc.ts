import { Channel, invoke } from "@tauri-apps/api/core";

export type { AgentDetectInfo } from "./gen/AgentDetectInfo";
export type { AgentCatalogRequest } from "./gen/AgentCatalogRequest";
export type { AgentHarnessCatalog } from "./gen/AgentHarnessCatalog";
export type { AgentIoEvent } from "./gen/AgentIoEvent";
export type { AgentSpawnRequest } from "./gen/AgentSpawnRequest";
export type { AppSettings } from "./gen/AppSettings";
export type { KeybindingSetting } from "./gen/KeybindingSetting";
export type { CkptFileContents } from "./gen/CkptFileContents";
export type { CkptFileDiff } from "./gen/CkptFileDiff";
export type { CkptHunkSummary } from "./gen/CkptHunkSummary";
export type { CkptTurnMeta } from "./gen/CkptTurnMeta";
export type { DiffSummary } from "./gen/DiffSummary";
export type { DiagnosticBundle } from "./gen/DiagnosticBundle";
export type { DiagnosticInfo } from "./gen/DiagnosticInfo";
export type { DirEntryInfo } from "./gen/DirEntryInfo";
export type { EnvInfo } from "./gen/EnvInfo";
export type { EditorRecoverySnapshot } from "./gen/EditorRecoverySnapshot";
export type { EditorRecoveryTab } from "./gen/EditorRecoveryTab";
export type { EditorConfigSettings } from "./gen/EditorConfigSettings";
export type { ImportedTheme } from "./gen/ImportedTheme";
export type { ThemeColorSetting } from "./gen/ThemeColorSetting";
export type { ThemeTokenSetting } from "./gen/ThemeTokenSetting";
export type { LaunchRequest } from "./gen/LaunchRequest";
export type { LspCompletionItem } from "./gen/LspCompletionItem";
export type { LspDiagnostic } from "./gen/LspDiagnostic";
export type { LspDiagnosticsEvent } from "./gen/LspDiagnosticsEvent";
export type { LspHover } from "./gen/LspHover";
export type { LspLocation } from "./gen/LspLocation";
export type { LspServerStatus } from "./gen/LspServerStatus";
export type { LspTextEdit } from "./gen/LspTextEdit";
export type { MediaPreviewResult } from "./gen/MediaPreviewResult";
export type { McpServerRecord } from "./gen/McpServerRecord";
export type { McpServerUpsert } from "./gen/McpServerUpsert";
export type { McpTransport } from "./gen/McpTransport";
export type { FileReadResult } from "./gen/FileReadResult";
export type { FileWriteResult } from "./gen/FileWriteResult";
export type { FsEvent } from "./gen/FsEvent";
export type { GitFileStatus } from "./gen/GitFileStatus";
export type { GitCommitResult } from "./gen/GitCommitResult";
export type { GitFileDiff } from "./gen/GitFileDiff";
export type { GitWorktree } from "./gen/GitWorktree";
export type { ProjectInfo } from "./gen/ProjectInfo";
export type { ProjectSymbol } from "./gen/ProjectSymbol";
export type { ProviderKind } from "./gen/ProviderKind";
export type { ProviderRecord } from "./gen/ProviderRecord";
export type { ProviderTestResult } from "./gen/ProviderTestResult";
export type { ProviderUsageSnapshot } from "./gen/ProviderUsageSnapshot";
export type { ProviderUpsert } from "./gen/ProviderUpsert";
export type { PtyEvent } from "./gen/PtyEvent";
export type { RecentProject } from "./gen/RecentProject";
export type { RuntimeDetectInfo } from "./gen/RuntimeDetectInfo";
export type { ResourceCounts } from "./gen/ResourceCounts";
export type { SearchBatch } from "./gen/SearchBatch";
export type { SearchHit } from "./gen/SearchHit";
export type { SearchOptions } from "./gen/SearchOptions";
export type { ReplaceSummary } from "./gen/ReplaceSummary";
export type { SessionArchive } from "./gen/SessionArchive";
export type { SessionCost } from "./gen/SessionCost";
export type { SessionSummary } from "./gen/SessionSummary";
export type { SessionUsage } from "./gen/SessionUsage";
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
import type { DiagnosticBundle } from "./gen/DiagnosticBundle";
import type { DiagnosticInfo } from "./gen/DiagnosticInfo";
import type { EnvInfo } from "./gen/EnvInfo";
import type { EditorRecoverySnapshot } from "./gen/EditorRecoverySnapshot";
import type { EditorConfigSettings } from "./gen/EditorConfigSettings";
import type { ImportedTheme } from "./gen/ImportedTheme";
import type { LaunchRequest } from "./gen/LaunchRequest";
import type { MediaPreviewResult } from "./gen/MediaPreviewResult";
import type { McpServerRecord } from "./gen/McpServerRecord";
import type { McpServerUpsert } from "./gen/McpServerUpsert";
import type { FileReadResult } from "./gen/FileReadResult";
import type { FileWriteResult } from "./gen/FileWriteResult";
import type { FsEvent } from "./gen/FsEvent";
import type { GitFileStatus } from "./gen/GitFileStatus";
import type { GitCommitResult } from "./gen/GitCommitResult";
import type { GitFileDiff } from "./gen/GitFileDiff";
import type { ProjectInfo } from "./gen/ProjectInfo";
import type { ProjectSymbol } from "./gen/ProjectSymbol";
import type { ProviderRecord } from "./gen/ProviderRecord";
import type { ProviderTestResult } from "./gen/ProviderTestResult";
import type { ProviderUsageSnapshot } from "./gen/ProviderUsageSnapshot";
import type { ProviderUpsert } from "./gen/ProviderUpsert";
import type { PtyEvent } from "./gen/PtyEvent";
import type { RecentProject } from "./gen/RecentProject";
import type { RuntimeDetectInfo } from "./gen/RuntimeDetectInfo";
import type { ResourceCounts } from "./gen/ResourceCounts";
import type { GitWorktree } from "./gen/GitWorktree";
import type { LspCompletionItem } from "./gen/LspCompletionItem";
import type { LspHover } from "./gen/LspHover";
import type { LspLocation } from "./gen/LspLocation";
import type { LspServerStatus } from "./gen/LspServerStatus";
import type { LspTextEdit } from "./gen/LspTextEdit";
import type { SearchBatch } from "./gen/SearchBatch";
import type { SearchOptions } from "./gen/SearchOptions";
import type { ReplaceSummary } from "./gen/ReplaceSummary";
import type { SessionArchive } from "./gen/SessionArchive";
import type { SessionSummary } from "./gen/SessionSummary";

export const ipc = {
  appReady: () => invoke<EnvInfo>("app_ready"),
  appTakeLaunchRequest: () => invoke<LaunchRequest | null>("app_take_launch_request"),
  appPrepareRestart: () => invoke<void>("app_prepare_restart"),
  perfMark: (name: string) => invoke<void>("perf_mark", { name }),
  windowOpenAgent: () => invoke<void>("window_open_agent"),
  windowOpenProject: (projectPath: string, filePath?: string) =>
    invoke<string>("window_open_project", { projectPath, filePath }),
  windowFocusMain: () => invoke<void>("window_focus_main"),
  appExit: () => invoke<void>("app_exit"),
  diagnosticsInfo: () => invoke<DiagnosticInfo>("diagnostics_info"),
  diagnosticsCreateBundle: () =>
    invoke<DiagnosticBundle>("diagnostics_create_bundle"),
  diagnosticsRevealLogs: () => invoke<void>("diagnostics_reveal_logs"),
  diagnosticsResourceCounts: () =>
    invoke<ResourceCounts>("diagnostics_resource_counts"),
  diagnosticsFaultPanic: (token: string) =>
    invoke<void>("diagnostics_fault_panic", { token }),
  projectOpen: (path: string) => invoke<ProjectInfo>("project_open", { path }),
  projectSymbols: (projectPath: string, paths: string[]) =>
    invoke<ProjectSymbol[]>("project_symbols", { projectPath, paths }),
  projectRecent: () => invoke<RecentProject[]>("project_recent"),
  fsList: (path: string) => invoke<DirEntryInfo[]>("fs_list", { path }),
  fsMediaPreview: (path: string) =>
    invoke<MediaPreviewResult | null>("fs_media_preview", { path }),
  fsRead: (path: string, encoding?: string) =>
    encoding
      ? invoke<FileReadResult>("fs_read_with_encoding", { path, encoding })
      : invoke<FileReadResult>("fs_read", { path }),
  fsWrite: (
    path: string,
    content: string,
    expectedHash?: string,
    encoding?: string,
    bom?: boolean,
  ) =>
    invoke<FileWriteResult>("fs_write", { path, content, expectedHash, encoding, bom }),
  fsWatchStart: (path: string, onEvent: (event: FsEvent) => void) => {
    const channel = new Channel<FsEvent>(onEvent);
    return invoke<number>("fs_watch_start", { path, channel });
  },
  fsWatchStop: (watcherId: number) => invoke<void>("fs_watch_stop", { watcherId }),
  editorRecoverySave: (snapshot: EditorRecoverySnapshot) =>
    invoke<void>("editor_recovery_save", { snapshot }),
  editorRecoveryLoad: (projectPath: string) =>
    invoke<EditorRecoverySnapshot | null>("editor_recovery_load", { projectPath }),
  editorRecoveryClear: (projectPath: string) =>
    invoke<void>("editor_recovery_clear", { projectPath }),
  editorConfigResolve: (path: string) =>
    invoke<EditorConfigSettings>("editor_config_resolve", { path }),
  lspOpen: (projectPath: string, path: string, languageId: string, content: string) =>
    invoke<LspServerStatus>("lsp_open", { projectPath, path, languageId, content }),
  lspChange: (projectPath: string, path: string, languageId: string, content: string) =>
    invoke<boolean>("lsp_change", { projectPath, path, languageId, content }),
  lspClose: (projectPath: string, path: string, languageId: string) =>
    invoke<void>("lsp_close", { projectPath, path, languageId }),
  lspCompletion: (
    projectPath: string,
    path: string,
    languageId: string,
    content: string,
    line: number,
    character: number,
  ) =>
    invoke<LspCompletionItem[]>("lsp_completion", {
      projectPath,
      path,
      languageId,
      content,
      line,
      character,
    }),
  lspHover: (
    projectPath: string,
    path: string,
    languageId: string,
    content: string,
    line: number,
    character: number,
  ) =>
    invoke<LspHover | null>("lsp_hover", {
      projectPath,
      path,
      languageId,
      content,
      line,
      character,
    }),
  lspDefinition: (
    projectPath: string,
    path: string,
    languageId: string,
    content: string,
    line: number,
    character: number,
  ) =>
    invoke<LspLocation[]>("lsp_definition", {
      projectPath,
      path,
      languageId,
      content,
      line,
      character,
    }),
  lspReferences: (
    projectPath: string,
    path: string,
    languageId: string,
    content: string,
    line: number,
    character: number,
  ) =>
    invoke<LspLocation[]>("lsp_references", {
      projectPath,
      path,
      languageId,
      content,
      line,
      character,
    }),
  lspRename: (
    projectPath: string,
    path: string,
    languageId: string,
    content: string,
    line: number,
    character: number,
    newName: string,
  ) =>
    invoke<LspTextEdit[]>("lsp_rename", {
      projectPath,
      path,
      languageId,
      content,
      line,
      character,
      newName,
    }),
  settingsGet: () => invoke<AppSettings>("settings_get"),
  settingsSet: (settings: AppSettings) => invoke<void>("settings_set", { settings }),
  themeImportVsCode: (path: string) =>
    invoke<ImportedTheme>("theme_import_vscode", { path }),
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
  mcpServersList: () => invoke<McpServerRecord[]>("mcp_servers_list"),
  mcpServersUpsert: (server: McpServerUpsert) =>
    invoke<McpServerRecord>("mcp_servers_upsert", { server }),
  mcpServersRemove: (id: string) => invoke<void>("mcp_servers_remove", { id }),
  gitStatus: (projectPath: string) => invoke<GitFileStatus[]>("git_status", { projectPath }),
  gitExecReadonly: (projectPath: string, args: string[]) =>
    invoke<string>("git_exec_readonly", { projectPath, args }),
  gitDiffFile: (projectPath: string, path: string, base = "HEAD") =>
    invoke<GitFileDiff>("git_diff_file", { projectPath, path, base }),
  gitCommit: (projectPath: string, message: string) =>
    invoke<GitCommitResult>("git_commit", { projectPath, message }),
  gitWorktreeList: (projectPath: string) =>
    invoke<GitWorktree[]>("git_worktree_list", { projectPath }),
  gitWorktreeAdd: (projectPath: string, name: string, base?: string) =>
    invoke<GitWorktree>("git_worktree_add", { projectPath, name, base }),
  gitWorktreeRemove: (projectPath: string, path: string, force = false) =>
    invoke<GitWorktree[]>("git_worktree_remove", { projectPath, path, force }),
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
  searchStart: (
    roots: string[],
    query: string,
    options: SearchOptions,
    onBatch: (batch: SearchBatch) => void,
  ) => {
    const channel = new Channel<SearchBatch>(onBatch);
    return invoke<number>("search_start", { roots, query, options, channel });
  },
  searchReplace: (
    roots: string[],
    query: string,
    replacement: string,
    options: SearchOptions,
  ) =>
    invoke<ReplaceSummary>("search_replace", {
      roots,
      query,
      replacement,
      options,
    }),
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
  sessionRename: (projectPath: string, id: string, title: string) =>
    invoke<SessionSummary>("session_rename", { projectPath, id, title }),
  sessionDelete: (projectPath: string, id: string) =>
    invoke<void>("session_delete", { projectPath, id }),
};
