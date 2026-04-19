mod git;
mod models;
mod pi;
mod storage;

use crate::models::{
    AbortPromptPayload, BootstrapPayload, CreateSessionPayload, CreateWorkspacePayload,
    DeleteSessionPayload, PersistedAppState, RefreshGitPayload,
    RefreshWorkspaceRuntimeCatalogPayload, RemoveWorkspacePayload, RenameSessionPayload,
    RenameWorkspacePayload, ResolveApprovalPayload, RuntimeBootstrapPayload, RuntimeHealthPayload,
    SelectWorkspaceSessionPayload, SendPromptPayload, UpdateWorkspaceSettingsPayload,
    WorkspaceRuntimeCatalogPayload, normalize_state,
};
use anyhow::Context;
use models::{GitSnapshot, default_state, new_session};
use std::{collections::HashMap, sync::Arc};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

#[derive(Clone)]
struct AppState {
    state: Arc<Mutex<PersistedAppState>>,
    runtime: pi::PiRuntimeHandle,
}

impl AppState {
    fn new(state: PersistedAppState) -> Self {
        Self {
            state: Arc::new(Mutex::new(state)),
            runtime: pi::PiRuntimeHandle::default(),
        }
    }
}

fn workspace_name_from_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|segment| segment.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "Workspace".to_string())
}

#[tauri::command]
async fn bootstrap_state(
    app: AppHandle,
    shared: State<'_, AppState>,
) -> Result<BootstrapPayload, String> {
    let state = shared.state.lock().await.clone();
    let git = state
        .workspaces
        .iter()
        .map(|workspace| (workspace.id.clone(), git::snapshot(&workspace.path)))
        .collect::<HashMap<_, _>>();

    storage::save(&app, &state).map_err(|error| error.to_string())?;

    Ok(BootstrapPayload { state, git })
}

#[tauri::command]
async fn create_workspace(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: CreateWorkspacePayload,
) -> Result<models::WorkspaceRecord, String> {
    let mut state = shared.state.lock().await;
    let workspace = models::new_workspace(
        payload
            .name
            .unwrap_or_else(|| workspace_name_from_path(&payload.path)),
        payload.path,
        state.workspaces.len() as i64 + 1,
    );

    state.active_workspace_id = Some(workspace.id.clone());
    state.active_session_id = workspace.sessions.first().map(|session| session.id.clone());
    state.workspaces.insert(0, workspace.clone());
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(workspace)
}

#[tauri::command]
async fn create_session(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: CreateSessionPayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    let workspace_index = state
        .workspaces
        .iter()
        .position(|workspace| workspace.id == payload.workspace_id)
        .context("workspace not found")
        .map_err(|error| error.to_string())?;

    let title = format!(
        "Chat {}",
        state.workspaces[workspace_index].sessions.len() + 1
    );
    let session = new_session(title);
    let workspace_id = state.workspaces[workspace_index].id.clone();
    state.active_session_id = Some(session.id.clone());
    state.active_workspace_id = Some(workspace_id);
    state.workspaces[workspace_index]
        .sessions
        .insert(0, session);
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn select_workspace_session(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: SelectWorkspaceSessionPayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    state.active_workspace_id = Some(payload.workspace_id);
    state.active_session_id = payload.session_id;
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn update_preferences(
    app: AppHandle,
    shared: State<'_, AppState>,
    preferences: models::AppPreferences,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    state.preferences = preferences;
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn update_workspace_settings(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: UpdateWorkspaceSettingsPayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    let workspace = state
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == payload.workspace_id)
        .context("workspace not found")
        .map_err(|error| error.to_string())?;
    workspace.approval_mode = payload.approval_mode;
    workspace.provider_id = payload.provider_id;
    workspace.model_id = payload.model_id;
    workspace.effort = payload.effort.unwrap_or(workspace.effort.clone());
    workspace.fast_mode = payload.fast_mode.unwrap_or(workspace.fast_mode);
    workspace.policy = payload.policy;
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn refresh_git_snapshot(
    shared: State<'_, AppState>,
    payload: RefreshGitPayload,
) -> Result<GitSnapshot, String> {
    let state = shared.state.lock().await;
    let workspace = state
        .workspaces
        .iter()
        .find(|workspace| workspace.id == payload.workspace_id)
        .context("workspace not found")
        .map_err(|error| error.to_string())?;
    Ok(git::snapshot(&workspace.path))
}

#[tauri::command]
async fn send_prompt(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: SendPromptPayload,
) -> Result<PersistedAppState, String> {
    let cloned_shared = shared.inner().clone();
    pi::launch_prompt_stream(app, cloned_shared.clone(), payload)
        .await
        .map_err(|error| error.to_string())?;

    Ok(cloned_shared.state.lock().await.clone())
}

#[tauri::command]
async fn resolve_approval(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: ResolveApprovalPayload,
) -> Result<PersistedAppState, String> {
    pi::resolve_approval(app, shared.inner().clone(), payload)
        .await
        .map_err(|error| error.to_string())?;
    Ok(shared.state.lock().await.clone())
}

#[tauri::command]
async fn bootstrap_runtime(
    app: AppHandle,
    shared: State<'_, AppState>,
) -> Result<RuntimeBootstrapPayload, String> {
    pi::bootstrap_runtime(app, shared.inner().clone())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn refresh_workspace_runtime_catalog(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: RefreshWorkspaceRuntimeCatalogPayload,
) -> Result<WorkspaceRuntimeCatalogPayload, String> {
    pi::refresh_workspace_runtime_catalog(app, shared.inner().clone(), payload)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn abort_prompt(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: AbortPromptPayload,
) -> Result<PersistedAppState, String> {
    pi::abort_prompt(app, shared.inner().clone(), payload)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn runtime_healthcheck(
    app: AppHandle,
    shared: State<'_, AppState>,
) -> Result<RuntimeHealthPayload, String> {
    pi::healthcheck(app, shared.inner().clone())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn rename_workspace(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: RenameWorkspacePayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    if let Some(workspace) = state
        .workspaces
        .iter_mut()
        .find(|w| w.id == payload.workspace_id)
    {
        workspace.name = payload.name;
    }
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn remove_workspace(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: RemoveWorkspacePayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    state.workspaces.retain(|w| w.id != payload.workspace_id);
    if state.active_workspace_id.as_ref() == Some(&payload.workspace_id) {
        state.active_workspace_id = state.workspaces.first().map(|w| w.id.clone());
        state.active_session_id = state
            .workspaces
            .first()
            .and_then(|w| w.sessions.first())
            .map(|s| s.id.clone());
    }
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn rename_session(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: RenameSessionPayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    if let Some(workspace) = state
        .workspaces
        .iter_mut()
        .find(|w| w.id == payload.workspace_id)
    {
        if let Some(session) = workspace
            .sessions
            .iter_mut()
            .find(|s| s.id == payload.session_id)
        {
            session.title = payload.title;
        }
    }
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn archive_session(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: models::ArchiveSessionPayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    if let Some(workspace) = state
        .workspaces
        .iter_mut()
        .find(|w| w.id == payload.workspace_id)
    {
        if let Some(session) = workspace
            .sessions
            .iter_mut()
            .find(|s| s.id == payload.session_id)
        {
            session.archived_at = Some(models::now_iso());
        }
    }
    if state.active_session_id.as_ref() == Some(&payload.session_id) {
        state.active_session_id = state
            .workspaces
            .iter()
            .find(|w| w.id == payload.workspace_id)
            .and_then(|w| w.sessions.iter().find(|s| s.archived_at.is_none()))
            .map(|s| s.id.clone());
    }
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn restore_session(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: models::ArchiveSessionPayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    if let Some(workspace) = state
        .workspaces
        .iter_mut()
        .find(|w| w.id == payload.workspace_id)
    {
        if let Some(session) = workspace
            .sessions
            .iter_mut()
            .find(|s| s.id == payload.session_id)
        {
            session.archived_at = None;
        }
    }
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn delete_session(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: DeleteSessionPayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    if let Some(workspace) = state
        .workspaces
        .iter_mut()
        .find(|w| w.id == payload.workspace_id)
    {
        workspace.sessions.retain(|s| s.id != payload.session_id);
    }
    if state.active_session_id.as_ref() == Some(&payload.session_id) {
        state.active_session_id = state
            .workspaces
            .iter()
            .find(|w| w.id == payload.workspace_id)
            .and_then(|w| w.sessions.iter().find(|s| s.archived_at.is_none()))
            .map(|s| s.id.clone());
    }
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn read_dir(path: String) -> Result<Vec<String>, String> {
    let expanded_path = if path.starts_with("~/") {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        path.replacen("~/", &format!("{}/", home), 1)
    } else if path == "~" {
        std::env::var("HOME").map_err(|e| e.to_string())?
    } else {
        path
    };

    let entries = std::fs::read_dir(expanded_path).map_err(|e| e.to_string())?;
    let mut dirs = Vec::new();

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_dir() || path.extension().and_then(|e| e.to_str()) == Some("app") {
                if let Some(name) = entry.file_name().to_str() {
                    if !name.starts_with('.') {
                        dirs.push(name.to_string());
                    }
                }
            }
        }
    }

    dirs.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(dirs)
}

#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    let expanded_path = if path.starts_with("~/") {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        path.replacen("~/", &format!("{}/", home), 1)
    } else if path == "~" {
        std::env::var("HOME").map_err(|e| e.to_string())?
    } else {
        path
    };

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(expanded_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(expanded_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(expanded_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn load_initial_state(app: &AppHandle) -> anyhow::Result<PersistedAppState> {
    if let Some(state) = storage::load(app)? {
        let state = normalize_state(state);
        storage::save(app, &state)?;
        return Ok(state);
    }

    let current_dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .display()
        .to_string();
    let workspace_name = workspace_name_from_path(&current_dir);
    let state = default_state(current_dir, workspace_name);
    storage::save(app, &state)?;
    Ok(state)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let state = load_initial_state(app.handle())?;
            app.manage(AppState::new(state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap_state,
            create_workspace,
            create_session,
            select_workspace_session,
            update_preferences,
            update_workspace_settings,
            refresh_git_snapshot,
            send_prompt,
            resolve_approval,
            bootstrap_runtime,
            refresh_workspace_runtime_catalog,
            abort_prompt,
            runtime_healthcheck,
            rename_workspace,
            remove_workspace,
            rename_session,
            archive_session,
            restore_session,
            delete_session,
            read_dir,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running picode");
}
