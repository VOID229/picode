use crate::{git::UndoCheckpoint, models::PersistedAppState};
use anyhow::Context;
use serde_json::to_string_pretty;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

pub fn app_data_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data directory")?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn state_file(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(app_data_dir(app)?.join("state.json"))
}

pub fn load(app: &AppHandle) -> anyhow::Result<Option<PersistedAppState>> {
    let path = state_file(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)?;
    let parsed = serde_json::from_str::<PersistedAppState>(&raw)?;
    Ok(Some(parsed))
}

pub fn save(app: &AppHandle, state: &PersistedAppState) -> anyhow::Result<()> {
    let path = state_file(app)?;
    fs::write(path, to_string_pretty(state)?)?;
    Ok(())
}

fn undo_checkpoint_path(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    user_message_id: &str,
) -> anyhow::Result<PathBuf> {
    let directory = app_data_dir(app)?
        .join("undo-checkpoints")
        .join(workspace_id)
        .join(session_id);
    fs::create_dir_all(&directory)?;
    Ok(directory.join(format!("{user_message_id}.json")))
}

pub fn save_undo_checkpoint(app: &AppHandle, checkpoint: &UndoCheckpoint) -> anyhow::Result<()> {
    let path = undo_checkpoint_path(
        app,
        &checkpoint.workspace_id,
        &checkpoint.session_id,
        &checkpoint.user_message_id,
    )?;
    fs::write(path, to_string_pretty(checkpoint)?)?;
    Ok(())
}

pub fn load_undo_checkpoint(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    user_message_id: &str,
) -> anyhow::Result<Option<UndoCheckpoint>> {
    let path = undo_checkpoint_path(app, workspace_id, session_id, user_message_id)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str::<UndoCheckpoint>(&raw)?))
}

pub fn delete_undo_checkpoint(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    user_message_id: &str,
) -> anyhow::Result<()> {
    let path = undo_checkpoint_path(app, workspace_id, session_id, user_message_id)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}
