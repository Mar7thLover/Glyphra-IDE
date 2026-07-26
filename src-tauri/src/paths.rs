//! Windows path normalization.
//!
//! `Path::canonicalize` and Tauri's resource resolution both hand back
//! extended-length (`\\?\C:\…`) paths on Windows. Rust and the Win32 API accept
//! them, but many of the tools Glyphra launches do not: Node refuses to resolve
//! a `\\?\` main module (`realpathSync` walks it down to `lstat 'D:'` and exits
//! before running a single line), and CLI harnesses inherit the same prefix
//! through their working directory.
//!
//! So every path that leaves this process — child-process arguments, working
//! directories, and anything handed to the frontend — goes through
//! [`simplified`] first. The prefix is kept only when dropping it would change
//! the meaning of the path (paths past `MAX_PATH`, reserved names, components
//! that end in a dot or a space).

use std::path::{Component, Path, PathBuf, Prefix};

/// Longest path the plain (non-verbatim) Win32 APIs accept.
const MAX_PATH: usize = 260;

/// Strip the `\\?\` prefix when the plain form addresses the same file.
///
/// Non-Windows paths and paths that genuinely need the verbatim form are
/// returned unchanged.
pub fn simplified(path: &Path) -> PathBuf {
    if !cfg!(windows) {
        return path.to_path_buf();
    }

    let mut components = path.components();
    let Some(Component::Prefix(prefix)) = components.next() else {
        return path.to_path_buf();
    };

    let stripped = match prefix.kind() {
        // `\\?\C:\dir` → `C:\dir`
        Prefix::VerbatimDisk(letter) => {
            let mut out = PathBuf::from(format!("{}:\\", letter as char));
            out.extend(components.filter(|c| !matches!(c, Component::RootDir)));
            out
        }
        // `\\?\UNC\server\share\dir` → `\\server\share\dir`
        Prefix::VerbatimUNC(server, share) => {
            let mut out = PathBuf::from(format!(
                "\\\\{}\\{}",
                server.to_string_lossy(),
                share.to_string_lossy()
            ));
            out.extend(components.filter(|c| !matches!(c, Component::RootDir)));
            out
        }
        // Device paths (`\\?\PIPE\…`, `\\.\COM1`) have no plain equivalent.
        _ => return path.to_path_buf(),
    };

    if is_plain_path_safe(&stripped) {
        stripped
    } else {
        path.to_path_buf()
    }
}

/// Convenience wrapper for the string-typed paths crossing the IPC boundary.
pub fn simplified_str(path: &str) -> String {
    simplified(Path::new(path)).to_string_lossy().into_owned()
}

/// Win32 rules the verbatim prefix exists to bypass. If a path relies on any of
/// them, it must keep the prefix.
fn is_plain_path_safe(path: &Path) -> bool {
    let text = path.to_string_lossy();
    if text.len() >= MAX_PATH {
        return false;
    }
    path.components().all(|component| match component {
        Component::Normal(part) => {
            let part = part.to_string_lossy();
            // Verbatim paths are the only way to address these; the plain form
            // is rewritten or rejected by the Win32 path parser.
            !part.ends_with('.')
                && !part.ends_with(' ')
                && !part.contains(['<', '>', '"', '|', '?', '*'])
                && !is_reserved_device_name(&part)
        }
        Component::CurDir | Component::ParentDir => false,
        _ => true,
    })
}

fn is_reserved_device_name(part: &str) -> bool {
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = part.split('.').next().unwrap_or(part);
    RESERVED
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn strips_verbatim_disk_paths() {
        assert_eq!(
            simplified(Path::new(r"\\?\D:\Projects\Glyphra-IDE")),
            PathBuf::from(r"D:\Projects\Glyphra-IDE")
        );
        assert_eq!(simplified(Path::new(r"\\?\C:\")), PathBuf::from(r"C:\"));
    }

    #[test]
    fn strips_verbatim_unc_paths() {
        assert_eq!(
            simplified(Path::new(r"\\?\UNC\server\share\dir")),
            PathBuf::from(r"\\server\share\dir")
        );
    }

    #[test]
    fn leaves_plain_and_device_paths_untouched() {
        for path in [r"D:\Projects\Glyphra-IDE", r"\\server\share", r"\\.\pipe\x"] {
            assert_eq!(simplified(Path::new(path)), PathBuf::from(path));
        }
    }

    #[test]
    fn keeps_the_prefix_when_the_plain_form_would_differ() {
        let long = format!(r"\\?\D:\{}", "segment\\".repeat(40));
        assert_eq!(simplified(Path::new(&long)), PathBuf::from(&long));

        let trailing_dot = r"\\?\D:\weird.dir.\file.txt";
        assert_eq!(
            simplified(Path::new(trailing_dot)),
            PathBuf::from(trailing_dot)
        );

        let reserved = r"\\?\D:\logs\COM1\out.txt";
        assert_eq!(simplified(Path::new(reserved)), PathBuf::from(reserved));
    }

    #[test]
    fn simplified_str_round_trips_strings() {
        assert_eq!(
            simplified_str(r"\\?\D:\Projects\Glyphra-IDE"),
            r"D:\Projects\Glyphra-IDE"
        );
    }
}
