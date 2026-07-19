pub mod agent;
pub mod app;
pub mod project;
pub mod providers;
pub mod settings;

#[cfg(test)]
mod export_bindings {
    //! Touch every `#[ts(export)]` type so `cargo test` regenerates
    //! `src/lib/ipc/gen/*.ts` for the drift checker.
    use super::{app::EnvInfo, project::*, settings::AppSettings};
    use crate::agent::{
        detect::AgentDetectInfo,
        runtime::{RuntimeDetectInfo, ToolStatus},
        supervisor::{AgentIoEvent, AgentSpawnRequest},
    };
    use crate::providers::{ProviderKind, ProviderRecord, ProviderTestResult, ProviderUpsert};
    use crate::state::RecentProject;
    use ts_rs::TS;

    #[test]
    fn export_bindings() {
        EnvInfo::export_all().expect("export EnvInfo");
        ProjectInfo::export_all().expect("export ProjectInfo");
        DirEntryInfo::export_all().expect("export DirEntryInfo");
        EntryKind::export_all().expect("export EntryKind");
        FileReadResult::export_all().expect("export FileReadResult");
        FileWriteResult::export_all().expect("export FileWriteResult");
        FsEvent::export_all().expect("export FsEvent");
        AppSettings::export_all().expect("export AppSettings");
        RecentProject::export_all().expect("export RecentProject");
        AgentDetectInfo::export_all().expect("export AgentDetectInfo");
        AgentSpawnRequest::export_all().expect("export AgentSpawnRequest");
        AgentIoEvent::export_all().expect("export AgentIoEvent");
        RuntimeDetectInfo::export_all().expect("export RuntimeDetectInfo");
        ToolStatus::export_all().expect("export ToolStatus");
        ProviderKind::export_all().expect("export ProviderKind");
        ProviderRecord::export_all().expect("export ProviderRecord");
        ProviderUpsert::export_all().expect("export ProviderUpsert");
        ProviderTestResult::export_all().expect("export ProviderTestResult");
    }
}
