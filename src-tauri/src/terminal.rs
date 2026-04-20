use crate::git;
use crate::models::{RunTerminalCommandResult, TerminalEvent};
use anyhow::{Context, Result, anyhow};
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::collections::HashMap;
use std::env;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 32;
const COMMAND_MARKER_PREFIX: &str = "\u{1b}]1337;PicodeCommandFinished=";
const COMMAND_MARKER_SUFFIX: &str = "\u{7}";
const TERMINAL_EVENT_CHANNEL: &str = "terminal://event";

#[derive(Clone, Default)]
pub struct TerminalHandle {
    sessions: Arc<Mutex<HashMap<String, TerminalSessionHandle>>>,
}

#[derive(Clone)]
struct TerminalSessionHandle {
    inner: Arc<TerminalSessionInner>,
}

struct TerminalSessionInner {
    workspace_id: String,
    workspace_path: String,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
    pending_commands: Mutex<HashMap<String, PendingCommand>>,
}

#[derive(Clone)]
struct PendingCommand {
    command: String,
    refresh_git: bool,
}

impl TerminalSessionHandle {
    fn new(
        workspace_id: String,
        workspace_path: String,
        writer: Box<dyn Write + Send>,
        master: Box<dyn MasterPty + Send>,
        child: Box<dyn portable_pty::Child + Send>,
    ) -> Self {
        Self {
            inner: Arc::new(TerminalSessionInner {
                workspace_id,
                workspace_path,
                writer: Mutex::new(writer),
                master: Mutex::new(master),
                child: Mutex::new(child),
                pending_commands: Mutex::new(HashMap::new()),
            }),
        }
    }

    fn write_all(&self, data: &str) -> Result<()> {
        let mut writer = self
            .inner
            .writer
            .lock()
            .map_err(|_| anyhow!("terminal writer lock poisoned"))?;
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let master = self
            .inner
            .master
            .lock()
            .map_err(|_| anyhow!("terminal master lock poisoned"))?;
        master.resize(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    fn register_command(&self, command_id: String, pending: PendingCommand) -> Result<()> {
        self.inner
            .pending_commands
            .lock()
            .map_err(|_| anyhow!("terminal pending command lock poisoned"))?
            .insert(command_id, pending);
        Ok(())
    }

    fn finish_command(
        &self,
        command_id: &str,
        exit_code: i32,
    ) -> Result<Option<(TerminalEvent, bool)>> {
        let pending = self
            .inner
            .pending_commands
            .lock()
            .map_err(|_| anyhow!("terminal pending command lock poisoned"))?
            .remove(command_id);

        let Some(pending) = pending else {
            return Ok(None);
        };

        let git_snapshot = pending
            .refresh_git
            .then(|| git::snapshot(&self.inner.workspace_path));

        Ok(Some((
            TerminalEvent::CommandFinished {
                workspace_id: self.inner.workspace_id.clone(),
                command_id: command_id.to_string(),
                command: pending.command,
                exit_code,
                git_snapshot,
            },
            pending.refresh_git,
        )))
    }

    fn wait_for_exit(&self) -> Option<i32> {
        let mut child = self.inner.child.lock().ok()?;
        let status = child.wait().ok()?;
        Some(status.exit_code().try_into().unwrap_or(i32::MAX))
    }
}

impl TerminalHandle {
    pub fn ensure_session(
        &self,
        app: AppHandle,
        workspace_id: String,
        workspace_path: String,
    ) -> Result<()> {
        if self
            .sessions
            .lock()
            .map_err(|_| anyhow!("terminal session map lock poisoned"))?
            .contains_key(&workspace_id)
        {
            return Ok(());
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                cols: DEFAULT_COLS,
                rows: DEFAULT_ROWS,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed to allocate terminal pty")?;

        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut command = CommandBuilder::new(shell);
        command.arg("-i");
        command.cwd(PathBuf::from(&workspace_path));

        let child = pair
            .slave
            .spawn_command(command)
            .context("failed to start interactive shell")?;

        let master = pair.master;
        let reader = master
            .try_clone_reader()
            .context("failed to clone terminal reader")?;
        let writer = master
            .take_writer()
            .context("failed to acquire terminal writer")?;

        let session =
            TerminalSessionHandle::new(workspace_id.clone(), workspace_path, writer, master, child);

        self.sessions
            .lock()
            .map_err(|_| anyhow!("terminal session map lock poisoned"))?
            .insert(workspace_id.clone(), session.clone());

        app.emit(
            TERMINAL_EVENT_CHANNEL,
            TerminalEvent::Started {
                workspace_id: workspace_id.clone(),
            },
        )?;

        let manager = self.clone();
        std::thread::spawn(move || {
            read_terminal_output(app, manager, session, workspace_id, reader);
        });

        Ok(())
    }

    pub fn write_input(&self, workspace_id: &str, data: &str) -> Result<()> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("terminal session map lock poisoned"))?
            .get(workspace_id)
            .cloned()
            .context("terminal session not found")?;
        session.write_all(data)
    }

    pub fn resize(&self, workspace_id: &str, cols: u16, rows: u16) -> Result<()> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("terminal session map lock poisoned"))?
            .get(workspace_id)
            .cloned()
            .context("terminal session not found")?;
        session.resize(cols, rows)
    }

    pub fn run_command(
        &self,
        workspace_id: &str,
        command: String,
        refresh_git: bool,
    ) -> Result<RunTerminalCommandResult> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("terminal session map lock poisoned"))?
            .get(workspace_id)
            .cloned()
            .context("terminal session not found")?;

        let command_id = Uuid::new_v4().to_string();
        session.register_command(
            command_id.clone(),
            PendingCommand {
                command: command.clone(),
                refresh_git,
            },
        )?;

        let wrapped = format!(
            "{command}\nprintf '\\033]1337;PicodeCommandFinished={command_id}:%s\\007' \"$?\"\n"
        );
        session.write_all(&wrapped)?;

        Ok(RunTerminalCommandResult { command_id })
    }

    fn remove_session(&self, workspace_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(workspace_id);
        }
    }
}

fn read_terminal_output(
    app: AppHandle,
    manager: TerminalHandle,
    session: TerminalSessionHandle,
    workspace_id: String,
    mut reader: Box<dyn Read + Send>,
) {
    let mut chunk = [0_u8; 4096];
    let mut parser_buffer = String::new();

    loop {
        let read = match reader.read(&mut chunk) {
            Ok(read) => read,
            Err(error) => {
                let _ = app.emit(
                    TERMINAL_EVENT_CHANNEL,
                    TerminalEvent::Error {
                        workspace_id: workspace_id.clone(),
                        message: error.to_string(),
                    },
                );
                manager.remove_session(&workspace_id);
                return;
            }
        };

        if read == 0 {
            break;
        }

        let output = String::from_utf8_lossy(&chunk[..read]).to_string();
        let _ = app.emit(
            TERMINAL_EVENT_CHANNEL,
            TerminalEvent::Output {
                workspace_id: workspace_id.clone(),
                chunk: output.clone(),
            },
        );

        parser_buffer.push_str(&output);
        for (command_id, exit_code) in extract_command_markers(&mut parser_buffer) {
            match session.finish_command(&command_id, exit_code) {
                Ok(Some((event, _))) => {
                    let _ = app.emit(TERMINAL_EVENT_CHANNEL, event);
                }
                Ok(None) => {}
                Err(error) => {
                    let _ = app.emit(
                        TERMINAL_EVENT_CHANNEL,
                        TerminalEvent::Error {
                            workspace_id: workspace_id.clone(),
                            message: error.to_string(),
                        },
                    );
                }
            }
        }
    }

    let exit_code = session.wait_for_exit();
    manager.remove_session(&workspace_id);
    let _ = app.emit(
        TERMINAL_EVENT_CHANNEL,
        TerminalEvent::Exit {
            workspace_id,
            exit_code,
        },
    );
}

fn extract_command_markers(buffer: &mut String) -> Vec<(String, i32)> {
    let mut results = Vec::new();

    loop {
        let Some(start) = buffer.find(COMMAND_MARKER_PREFIX) else {
            trim_parser_buffer(buffer);
            break;
        };

        let payload_start = start + COMMAND_MARKER_PREFIX.len();
        let Some(end_offset) = buffer[payload_start..].find(COMMAND_MARKER_SUFFIX) else {
            trim_parser_buffer(buffer);
            break;
        };

        let payload_end = payload_start + end_offset;
        let payload = buffer[payload_start..payload_end].to_string();

        if let Some((command_id, exit_code)) = payload.rsplit_once(':') {
            if let Ok(exit_code) = exit_code.parse::<i32>() {
                results.push((command_id.to_string(), exit_code));
            }
        }

        let marker_end = payload_end + COMMAND_MARKER_SUFFIX.len();
        buffer.replace_range(start..marker_end, "");
    }

    results
}

fn trim_parser_buffer(buffer: &mut String) {
    const MAX_BUFFER: usize = 4096;
    if buffer.len() > MAX_BUFFER {
        let truncate_at = buffer.len().saturating_sub(MAX_BUFFER);
        buffer.drain(..truncate_at);
    }
}
