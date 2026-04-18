mod git;
mod models;
mod pi;
mod storage;

use crate::models::{
    ApprovalDecision, ApprovalState, BootstrapPayload, CreateSessionPayload,
    CreateWorkspacePayload, PersistedAppState, RefreshGitPayload, ResolveApprovalPayload,
    SelectWorkspaceSessionPayload, SendPromptPayload, TimelineItem, UpdateWorkspaceSettingsPayload,
    now_iso,
};
use anyhow::Context;
use models::{GitSnapshot, default_state, new_session};
use std::{collections::HashMap, sync::Arc};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    state: Arc<Mutex<PersistedAppState>>,
}

impl AppState {
    fn new(state: PersistedAppState) -> Self {
        Self {
            state: Arc::new(Mutex::new(state)),
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
    {
        let mut state = shared.state.lock().await;
        if let Some(workspace) = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == payload.workspace_id)
        {
            if let Some(session) = workspace
                .sessions
                .iter_mut()
                .find(|session| session.id == payload.session_id)
            {
                for item in &mut session.timeline {
                    if let TimelineItem::ApprovalRequest { approval, .. } = item {
                        if approval.id == payload.approval_id {
                            approval.status = match payload.decision {
                                ApprovalDecision::Approved => ApprovalState::Approved,
                                ApprovalDecision::Rejected => ApprovalState::Rejected,
                            };
                        }
                    }
                }

                session.timeline.push(TimelineItem::ApprovalResolution {
                    id: Uuid::new_v4().to_string(),
                    created_at: now_iso(),
                    approval_id: payload.approval_id.clone(),
                    decision: payload.decision.clone(),
                    summary: match payload.decision {
                        ApprovalDecision::Approved => {
                            "User approved the requested action.".to_string()
                        }
                        ApprovalDecision::Rejected => {
                            "User rejected the requested action.".to_string()
                        }
                    },
                });
                session.updated_at = now_iso();
            }
        }
        storage::save(&app, &state).map_err(|error| error.to_string())?;
    }

    pi::resolve_approval_event(
        &app,
        &payload.workspace_id,
        &payload.session_id,
        &payload.approval_id,
        payload.decision.clone(),
    )
    .await;

    Ok(shared.state.lock().await.clone())
}

#[tauri::command]
async fn rename_workspace(
    app: AppHandle,
    shared: State<'_, AppState>,
    workspace_id: String,
    name: String,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    if let Some(workspace) = state
        .workspaces
        .iter_mut()
        .find(|w| w.id == workspace_id)
    {
        workspace.name = name;
    }
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn remove_workspace(
    app: AppHandle,
    shared: State<'_, AppState>,
    workspace_id: String,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    state.workspaces.retain(|w| w.id != workspace_id);
    if state.active_workspace_id.as_ref() == Some(&workspace_id) {
        state.active_workspace_id = state.workspaces.first().map(|w| w.id.clone());
        state.active_session_id = state.workspaces.first().and_then(|w| w.sessions.first()).map(|s| s.id.clone());
    }
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn rename_session(
    app: AppHandle,
    shared: State<'_, AppState>,
    workspace_id: String,
    session_id: String,
    title: String,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    if let Some(workspace) = state
        .workspaces
        .iter_mut()
        .find(|w| w.id == workspace_id)
    {
        if let Some(session) = workspace.sessions.iter_mut().find(|s| s.id == session_id) {
            session.title = title;
        }
    }
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn delete_session(
    app: AppHandle,
    shared: State<'_, AppState>,
    workspace_id: String,
    session_id: String,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    if let Some(workspace) = state
        .workspaces
        .iter_mut()
        .find(|w| w.id == workspace_id)
    {
        workspace.sessions.retain(|s| s.id != session_id);
    }
    if state.active_session_id.as_ref() == Some(&session_id) {
        state.active_session_id = state.workspaces.iter().find(|w| w.id == workspace_id).and_then(|w| w.sessions.first()).map(|s| s.id.clone());
    }
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

fn load_initial_state(app: &AppHandle) -> anyhow::Result<PersistedAppState> {
    if let Some(state) = storage::load(app)? {
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
            rename_workspace,
            remove_workspace,
            rename_session,
            delete_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running picode");
}
