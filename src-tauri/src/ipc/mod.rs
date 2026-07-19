pub mod app;
pub mod project;
pub mod settings;

#[cfg(test)]
mod export_bindings {
    //! Touch every `#[ts(export)]` type so `cargo test` regenerates
    //! `src/lib/ipc/gen/*.ts` for the drift checker.
    use super::{app::EnvInfo, project::*, settings::AppSettings};
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
    }
}
