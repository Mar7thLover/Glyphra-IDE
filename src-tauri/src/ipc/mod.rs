pub mod agent;
pub mod agent_term;
pub mod app;
pub mod ckpt;
pub mod diagnostics;
pub mod editorconfig;
pub mod git;
pub mod lsp;
pub mod mcp;
pub mod project;
pub mod providers;
pub mod pty;
pub mod recovery;
pub mod search;
pub mod sessions;
pub mod settings;
pub mod theme;

#[cfg(test)]
mod export_bindings {
    //! Touch every `#[ts(export)]` type so `cargo test` regenerates
    //! `src/lib/ipc/gen/*.ts` for the drift checker.
    use super::{
        app::{EnvInfo, LaunchRequest},
        diagnostics::{DiagnosticBundle, DiagnosticInfo},
        editorconfig::EditorConfigSettings,
        project::*,
        recovery::{EditorRecoverySnapshot, EditorRecoveryTab},
        sessions::{SessionArchive, SessionCost, SessionSummary, SessionUsage},
        settings::AppSettings,
        theme::{ImportedTheme, ThemeColorSetting, ThemeTokenSetting},
    };
    use crate::agent::{
        catalog::{
            AgentCatalogRequest, AgentHarnessCatalog, AgentMcpServerInfo, AgentModelInfo,
            AgentPermissionProfile, AgentReasoningEffort, AgentSkillInfo,
        },
        detect::AgentDetectInfo,
        runtime::{RuntimeDetectInfo, ToolStatus},
        supervisor::{AgentIoEvent, AgentSpawnRequest},
    };
    use crate::agent_terminal::{AgentTermCreateRequest, AgentTermEnvVar, AgentTermOutput};
    use crate::gitx::{
        checkpoints::{CkptFileContents, CkptFileDiff, CkptHunkSummary, CkptTurnMeta},
        cli::{DiffSummary, GitCommitResult, GitFileDiff, GitFileStatus},
        worktree::GitWorktree,
    };
    use crate::lsp::{
        LspCompletionItem, LspDiagnostic, LspDiagnosticsEvent, LspHover, LspLocation,
        LspServerStatus, LspTextEdit,
    };
    use crate::mcp::{McpServerRecord, McpServerUpsert, McpTransport};
    use crate::providers::{ProviderKind, ProviderRecord, ProviderTestResult, ProviderUpsert};
    use crate::pty::PtyEvent;
    use crate::search::{SearchBatch, SearchHit};
    use crate::state::RecentProject;
    use ts_rs::TS;

    #[test]
    fn export_bindings() {
        EnvInfo::export_all().expect("export EnvInfo");
        LaunchRequest::export_all().expect("export LaunchRequest");
        ProjectInfo::export_all().expect("export ProjectInfo");
        DirEntryInfo::export_all().expect("export DirEntryInfo");
        EntryKind::export_all().expect("export EntryKind");
        FileReadResult::export_all().expect("export FileReadResult");
        FileWriteResult::export_all().expect("export FileWriteResult");
        MediaPreviewResult::export_all().expect("export MediaPreviewResult");
        ProjectSymbol::export_all().expect("export ProjectSymbol");
        FsEvent::export_all().expect("export FsEvent");
        EditorRecoveryTab::export_all().expect("export EditorRecoveryTab");
        EditorRecoverySnapshot::export_all().expect("export EditorRecoverySnapshot");
        AppSettings::export_all().expect("export AppSettings");
        ImportedTheme::export_all().expect("export ImportedTheme");
        ThemeColorSetting::export_all().expect("export ThemeColorSetting");
        ThemeTokenSetting::export_all().expect("export ThemeTokenSetting");
        DiagnosticInfo::export_all().expect("export DiagnosticInfo");
        DiagnosticBundle::export_all().expect("export DiagnosticBundle");
        EditorConfigSettings::export_all().expect("export EditorConfigSettings");
        McpTransport::export_all().expect("export McpTransport");
        McpServerRecord::export_all().expect("export McpServerRecord");
        McpServerUpsert::export_all().expect("export McpServerUpsert");
        RecentProject::export_all().expect("export RecentProject");
        AgentDetectInfo::export_all().expect("export AgentDetectInfo");
        AgentCatalogRequest::export_all().expect("export AgentCatalogRequest");
        AgentHarnessCatalog::export_all().expect("export AgentHarnessCatalog");
        AgentModelInfo::export_all().expect("export AgentModelInfo");
        AgentReasoningEffort::export_all().expect("export AgentReasoningEffort");
        AgentPermissionProfile::export_all().expect("export AgentPermissionProfile");
        AgentSkillInfo::export_all().expect("export AgentSkillInfo");
        AgentMcpServerInfo::export_all().expect("export AgentMcpServerInfo");
        AgentSpawnRequest::export_all().expect("export AgentSpawnRequest");
        AgentIoEvent::export_all().expect("export AgentIoEvent");
        RuntimeDetectInfo::export_all().expect("export RuntimeDetectInfo");
        ToolStatus::export_all().expect("export ToolStatus");
        ProviderKind::export_all().expect("export ProviderKind");
        ProviderRecord::export_all().expect("export ProviderRecord");
        ProviderUpsert::export_all().expect("export ProviderUpsert");
        ProviderTestResult::export_all().expect("export ProviderTestResult");
        GitFileStatus::export_all().expect("export GitFileStatus");
        GitFileDiff::export_all().expect("export GitFileDiff");
        GitCommitResult::export_all().expect("export GitCommitResult");
        GitWorktree::export_all().expect("export GitWorktree");
        DiffSummary::export_all().expect("export DiffSummary");
        CkptTurnMeta::export_all().expect("export CkptTurnMeta");
        CkptFileDiff::export_all().expect("export CkptFileDiff");
        CkptFileContents::export_all().expect("export CkptFileContents");
        CkptHunkSummary::export_all().expect("export CkptHunkSummary");
        LspServerStatus::export_all().expect("export LspServerStatus");
        LspDiagnostic::export_all().expect("export LspDiagnostic");
        LspDiagnosticsEvent::export_all().expect("export LspDiagnosticsEvent");
        LspCompletionItem::export_all().expect("export LspCompletionItem");
        LspHover::export_all().expect("export LspHover");
        LspLocation::export_all().expect("export LspLocation");
        LspTextEdit::export_all().expect("export LspTextEdit");
        SearchHit::export_all().expect("export SearchHit");
        SearchBatch::export_all().expect("export SearchBatch");
        PtyEvent::export_all().expect("export PtyEvent");
        AgentTermCreateRequest::export_all().expect("export AgentTermCreateRequest");
        AgentTermEnvVar::export_all().expect("export AgentTermEnvVar");
        AgentTermOutput::export_all().expect("export AgentTermOutput");
        SessionSummary::export_all().expect("export SessionSummary");
        SessionArchive::export_all().expect("export SessionArchive");
        SessionUsage::export_all().expect("export SessionUsage");
        SessionCost::export_all().expect("export SessionCost");
    }
}
