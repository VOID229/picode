use crate::models::PersistedAppState;
use anyhow::Context;
use serde_json::to_string_pretty;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

pub fn state_file(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data directory")?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("state.json"))
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
