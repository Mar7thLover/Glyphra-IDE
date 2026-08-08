//! Process constructors that keep background tools invisible on Windows.

use std::{ffi::OsStr, process::Command as StdCommand};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn std_command(program: impl AsRef<OsStr>) -> StdCommand {
    // Only the Windows branch mutates; other platforms return it untouched.
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut command = StdCommand::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub fn tokio_command(program: impl AsRef<OsStr>) -> tokio::process::Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut command = tokio::process::Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
