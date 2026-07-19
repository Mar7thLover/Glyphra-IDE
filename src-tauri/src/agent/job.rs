//! Process-tree lifetime helpers.
//!
//! On Windows, each agent child is assigned to a Job Object with
//! `KILL_ON_JOB_CLOSE` so `npx` → node → agent grandchildren die when Glyphra
//! drops the job (kill / window close). Elsewhere this is a no-op.

use tokio::process::Child;

#[cfg(windows)]
mod windows_impl {
    use tokio::process::Child;
    use win32job::Job;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    pub struct JobGuard {
        job: Option<Job>,
        process: Option<HANDLE>,
    }

    impl JobGuard {
        pub fn detached() -> Self {
            Self {
                job: None,
                process: None,
            }
        }
    }

    impl Drop for JobGuard {
        fn drop(&mut self) {
            if let Some(handle) = self.process.take() {
                unsafe {
                    let _ = CloseHandle(handle);
                }
            }
            // Dropping `job` closes the job handle → KILL_ON_JOB_CLOSE terminates
            // every process still associated with the job (including grandchildren).
        }
    }

    pub fn attach(child: &Child) -> Result<JobGuard, String> {
        let pid = child
            .id()
            .ok_or_else(|| "agent child has no pid".to_string())?;

        let job = Job::create().map_err(|err| format!("create job object: {err}"))?;
        let mut info = job
            .query_extended_limit_info()
            .map_err(|err| format!("query job limits: {err}"))?;
        info.limit_kill_on_job_close();
        job.set_extended_limit_info(&mut info)
            .map_err(|err| format!("set job limits: {err}"))?;

        let process = unsafe {
            OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
                .map_err(|err| format!("OpenProcess({pid}): {err}"))?
        };
        if let Err(err) = job.assign_process(process.0 as isize) {
            unsafe {
                let _ = CloseHandle(process);
            }
            return Err(format!("assign pid {pid} to job: {err}"));
        }

        Ok(JobGuard {
            job: Some(job),
            process: Some(process),
        })
    }
}

#[cfg(windows)]
pub use windows_impl::{attach, JobGuard};

#[cfg(not(windows))]
pub struct JobGuard;

#[cfg(not(windows))]
impl JobGuard {
    pub fn detached() -> Self {
        Self
    }
}

#[cfg(not(windows))]
pub fn attach(_child: &Child) -> Result<JobGuard, String> {
    Ok(JobGuard)
}
