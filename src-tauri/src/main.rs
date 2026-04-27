mod git;
mod models;
mod pi;
mod storage;
mod terminal;

use crate::models::{
    AbortPromptPayload, AppPaths, AppUpdatePayload, BootstrapPayload, CloseTerminalSessionPayload,
    CreateSessionPayload, CreateWorkspacePayload, DeleteSessionPayload,
    EnsureTerminalSessionPayload, PersistedAppState, PrepareGitActionPayload, PreparedGitAction,
    RefreshGitPayload, RefreshWorkspaceRuntimeCatalogPayload, RemoveWorkspacePayload,
    RenameSessionPayload, RenameWorkspacePayload, ReorderSessionPayload, ReorderWorkspacePayload,
    ResizeTerminalPayload, ResolveApprovalPayload, ResolveExtensionUiRequestPayload,
    RunGitActionPayload, RunGitActionResult, RunTerminalCommandPayload, RunTerminalCommandResult,
    RuntimeBootstrapPayload, RuntimeHealthPayload, SelectWorkspaceSessionPayload,
    SendPromptPayload, SessionIdentityPayload, UndoUserTurnPayload, UpdateWorkspaceSettingsPayload,
    WorkspaceRuntimeCatalogPayload, WriteTerminalInputPayload, WriteTextFilePayload,
    normalize_state,
};
use anyhow::Context;
use models::{GitSnapshot, SessionModelSelection, default_state, new_session};
use std::{collections::HashMap, fs, sync::Arc};
use tauri::{
    AppHandle, Manager, State,
    menu::{MenuBuilder, SubmenuBuilder},
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Mutex;

#[derive(Clone)]
struct AppState {
    state: Arc<Mutex<PersistedAppState>>,
    runtime: pi::PiRuntimeHandle,
    terminal: terminal::TerminalHandle,
}

impl AppState {
    fn new(state: PersistedAppState) -> Self {
        Self {
            state: Arc::new(Mutex::new(state)),
            runtime: pi::PiRuntimeHandle::default(),
            terminal: terminal::TerminalHandle::default(),
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
    let title_backfills = pi::sessions_requiring_title_backfill(&state);
    let git = state
        .workspaces
        .iter()
        .map(|workspace| (workspace.id.clone(), git::snapshot(&workspace.path)))
        .collect::<HashMap<_, _>>();

    storage::save(&app, &state).map_err(|error| error.to_string())?;

    for (workspace_id, session_id) in title_backfills {
        pi::enqueue_thread_title(
            app.clone(),
            shared.inner().clone(),
            workspace_id,
            session_id,
        );
    }

    Ok(BootstrapPayload { state, git })
}

#[tauri::command]
async fn app_paths(app: AppHandle) -> Result<AppPaths, String> {
    let app_data_dir = storage::app_data_dir(&app).map_err(|error| error.to_string())?;
    let logs_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&logs_dir).map_err(|error| error.to_string())?;

    Ok(AppPaths {
        keybindings_path: app_data_dir
            .join("keybindings.json")
            .to_string_lossy()
            .into_owned(),
        app_data_dir: app_data_dir.to_string_lossy().into_owned(),
        logs_dir: logs_dir.to_string_lossy().into_owned(),
    })
}

const CHECK_FOR_UPDATES_MENU_ID: &str = "check_for_updates";

fn updater_endpoint(channel: Option<&str>) -> &'static str {
    match channel {
        Some("nightly") => {
            "https://github.com/VOID229/picode/releases/download/nightly/nightly.json"
        }
        _ => "https://github.com/VOID229/picode/releases/latest/download/latest.json",
    }
}

async fn check_app_update(
    app: &AppHandle,
    channel: Option<&str>,
) -> Result<AppUpdatePayload, String> {
    let current_version = app.package_info().version.to_string();
    let endpoint = updater_endpoint(channel)
        .parse()
        .map_err(|error| format!("invalid updater endpoint: {error}"))?;

    let mut updater_builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?;
    if channel == Some("nightly") {
        updater_builder =
            updater_builder.version_comparator(|current, update| update.version != current);
    }
    let updater = updater_builder.build().map_err(|error| error.to_string())?;

    match updater.check().await {
        Ok(None) => {
            return Ok(AppUpdatePayload {
                current_version,
                latest_version: None,
                status: "up-to-date".to_string(),
                download_path: None,
                release_url: None,
            });
        }
        Ok(Some(update)) => {
            return Ok(AppUpdatePayload {
                current_version: current_version.clone(),
                latest_version: Some(update.version.to_string()),
                status: "update-available".to_string(),
                download_path: None,
                release_url: None,
            });
        }
        Err(error) => {
            let message = error.to_string();
            if message.contains("fallback platforms") || message.contains("platforms") {
                return Ok(AppUpdatePayload {
                    current_version,
                    latest_version: None,
                    status: "no-release".to_string(),
                    download_path: None,
                    release_url: None,
                });
            }
            return Err(message);
        }
    };
}

async fn do_install_app_update(
    app: &AppHandle,
    channel: Option<&str>,
) -> Result<AppUpdatePayload, String> {
    let current_version = app.package_info().version.to_string();
    let endpoint = updater_endpoint(channel)
        .parse()
        .map_err(|error| format!("invalid updater endpoint: {error}"))?;

    let mut updater_builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?;
    if channel == Some("nightly") {
        updater_builder =
            updater_builder.version_comparator(|current, update| update.version != current);
    }
    let updater = updater_builder.build().map_err(|error| error.to_string())?;

    let update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No update is available.".to_string())?;

    let latest_version = update.version.to_string();
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;

    Ok(AppUpdatePayload {
        current_version,
        latest_version: Some(latest_version),
        status: "installed".to_string(),
        download_path: None,
        release_url: None,
    })
}

#[tauri::command]
async fn check_for_app_update(
    app: AppHandle,
    channel: Option<String>,
) -> Result<AppUpdatePayload, String> {
    check_app_update(&app, channel.as_deref()).await
}

#[tauri::command]
async fn install_app_update(
    app: AppHandle,
    channel: Option<String>,
) -> Result<AppUpdatePayload, String> {
    do_install_app_update(&app, channel.as_deref()).await
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
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

    let selection = {
        let workspace = &state.workspaces[workspace_index];
        SessionModelSelection {
            provider_id: workspace.provider_id.clone(),
            model_id: workspace.model_id.clone(),
            effort: workspace.effort.clone(),
            fast_mode: workspace.fast_mode,
        }
    };
    let session = new_session("New thread", selection);
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
    let global_selection = state.preferences.model_selection_scope == "global";
    let provider_id = payload.provider_id;
    let model_id = payload.model_id;
    let (effort, fast_mode) = {
        let workspace = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == payload.workspace_id)
            .context("workspace not found")
            .map_err(|error| error.to_string())?;
        workspace.approval_mode = payload.approval_mode;
        let effort = payload.effort.unwrap_or(workspace.effort.clone());
        let fast_mode = payload.fast_mode.unwrap_or(workspace.fast_mode);
        workspace.provider_id = provider_id.clone();
        workspace.model_id = model_id.clone();
        workspace.effort = effort.clone();
        workspace.fast_mode = fast_mode;
        workspace.policy = payload.policy;

        if let Some(session_id) = payload.session_id {
            if let Some(session) = workspace
                .sessions
                .iter_mut()
                .find(|session| session.id == session_id)
            {
                session.selection.provider_id = provider_id.clone();
                session.selection.model_id = model_id.clone();
                session.selection.effort = effort.clone();
                session.selection.fast_mode = fast_mode;
            }
        }

        (effort, fast_mode)
    };

    if global_selection {
        state.preferences.provider_id = provider_id.clone();
        state.preferences.model_id = model_id.clone();
        state.preferences.effort = effort.clone();
        state.preferences.fast_mode = fast_mode;
    }
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
async fn prepare_git_action(
    shared: State<'_, AppState>,
    payload: PrepareGitActionPayload,
) -> Result<PreparedGitAction, String> {
    let state = shared.state.lock().await;
    let workspace = state
        .workspaces
        .iter()
        .find(|workspace| workspace.id == payload.workspace_id)
        .context("workspace not found")
        .map_err(|error| error.to_string())?;
    git::prepare_git_action(&workspace.path).map_err(|error| error.to_string())
}

#[tauri::command]
async fn initialize_git_repository(
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
    git::initialize_repository(&workspace.path).map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_git_action(
    shared: State<'_, AppState>,
    payload: RunGitActionPayload,
) -> Result<RunGitActionResult, String> {
    let workspace_path = {
        let state = shared.state.lock().await;
        state
            .workspaces
            .iter()
            .find(|workspace| workspace.id == payload.workspace_id)
            .map(|workspace| workspace.path.clone())
            .context("workspace not found")
            .map_err(|error| error.to_string())?
    };

    let custom_instructions = payload.custom_instructions.as_deref();
    let mut commit_message = payload
        .message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let prepared = git::prepare_git_action(&workspace_path).map_err(|error| error.to_string())?;
    let should_commit = matches!(
        payload.action,
        models::GitAction::Commit | models::GitAction::CommitPush | models::GitAction::CreatePr
    ) && (prepared.has_staged
        || (payload.include_unstaged && prepared.has_unstaged));

    if should_commit && commit_message.is_none() {
        let diff_context = git::diff_for_message(&workspace_path, payload.include_unstaged)
            .map_err(|error| error.to_string())?;
        commit_message = pi::generate_git_commit_message(
            shared.inner(),
            &workspace_path,
            &diff_context,
            custom_instructions,
        )
        .await
        .map_err(|error| error.to_string())?;
    }

    if matches!(payload.action, models::GitAction::CreatePr) {
        let mut steps = Vec::new();
        if should_commit {
            let message = commit_message
                .as_deref()
                .context("A commit message is required.")
                .map_err(|error| error.to_string())?;
            if git::commit_workspace_changes(&workspace_path, payload.include_unstaged, message)
                .map_err(|error| error.to_string())?
            {
                steps.push("committed changes".to_string());
            }
        }

        let context =
            git::recent_commit_context(&workspace_path).map_err(|error| error.to_string())?;
        let pr_message = pi::generate_git_pr_message(
            shared.inner(),
            &workspace_path,
            &context,
            custom_instructions,
        )
        .await
        .map_err(|error| error.to_string())?;

        let (pr_title, pr_body) = pr_message
            .as_ref()
            .map(|(title, body)| (title.as_str(), body.as_str()))
            .context("A PR title is required.")
            .map_err(|error| error.to_string())?;

        git::push_workspace_branch(&workspace_path).map_err(|error| error.to_string())?;
        steps.push("pushed branch".to_string());
        let pr_url = git::create_pull_request(&workspace_path, pr_title, pr_body, payload.draft)
            .map_err(|error| error.to_string())?;
        steps.push("created pull request".to_string());

        return Ok(RunGitActionResult {
            summary: steps.join(", "),
            generated_message: commit_message,
            pr_url: Some(pr_url),
            git: git::snapshot(&workspace_path),
        });
    }

    git::run_git_action(
        &workspace_path,
        payload.action,
        payload.include_unstaged,
        commit_message.as_deref(),
        None,
        None,
        payload.draft,
    )
    .map_err(|error| error.to_string())
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
async fn resolve_extension_ui_request(
    shared: State<'_, AppState>,
    payload: ResolveExtensionUiRequestPayload,
) -> Result<(), String> {
    pi::resolve_extension_ui_request(shared.inner().clone(), payload)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn undo_user_turn(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: UndoUserTurnPayload,
) -> Result<PersistedAppState, String> {
    let checkpoint = storage::load_undo_checkpoint(
        &app,
        &payload.workspace_id,
        &payload.session_id,
        &payload.user_message_id,
    )
    .map_err(|error| error.to_string())?;

    let workspace_path = {
        let state = shared.state.lock().await;
        state
            .workspaces
            .iter()
            .find(|workspace| workspace.id == payload.workspace_id)
            .map(|workspace| workspace.path.clone())
            .context("workspace not found")
            .map_err(|error| error.to_string())?
    };

    if let Some(checkpoint) = checkpoint.as_ref() {
        if let Ok(Some(redo_checkpoint)) = git::capture_undo_checkpoint(
            &payload.workspace_id,
            &payload.session_id,
            &payload.user_message_id,
            &workspace_path,
        ) {
            let _ = storage::save_redo_checkpoint(&app, &redo_checkpoint);
        }

        git::restore_undo_checkpoint(&workspace_path, checkpoint)
            .map_err(|error| error.to_string())?;
    }

    let (removed_user_ids, session_file_to_remove) = {
        let mut state = shared.state.lock().await;
        let session = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == payload.workspace_id)
            .and_then(|workspace| {
                workspace
                    .sessions
                    .iter_mut()
                    .find(|session| session.id == payload.session_id)
            })
            .context("session not found")
            .map_err(|error| error.to_string())?;

        let Some(index) = session.timeline.iter().position(|item| {
            matches!(
                item,
                models::TimelineItem::UserMessage { id, .. } if id == &payload.user_message_id
            )
        }) else {
            return Err("user message not found in session timeline".to_string());
        };

        let removed = session.timeline.split_off(index);
        session.status = models::SessionStatus::Idle;
        let session_file_to_remove = session.runtime.pi_session_file.take();
        session.updated_at = models::now_iso();

        let removed_user_ids = removed
            .into_iter()
            .filter_map(|item| match item {
                models::TimelineItem::UserMessage { id, .. } => Some(id),
                _ => None,
            })
            .collect::<Vec<_>>();

        storage::save(&app, &state).map_err(|error| error.to_string())?;
        (removed_user_ids, session_file_to_remove)
    };

    for user_message_id in removed_user_ids {
        let _ = storage::delete_undo_checkpoint(
            &app,
            &payload.workspace_id,
            &payload.session_id,
            &user_message_id,
        );
    }
    if let Some(session_file) = session_file_to_remove {
        let _ = fs::remove_file(session_file);
    }

    Ok(shared.state.lock().await.clone())
}

#[tauri::command]
async fn redo_user_turn(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: UndoUserTurnPayload,
) -> Result<PersistedAppState, String> {
    let checkpoint = storage::load_redo_checkpoint(
        &app,
        &payload.workspace_id,
        &payload.session_id,
        &payload.user_message_id,
    )
    .map_err(|error| error.to_string())?
    .context("Redo is unavailable for this message because no checkpoint was stored.")
    .map_err(|error| error.to_string())?;

    let workspace_path = {
        let state = shared.state.lock().await;
        state
            .workspaces
            .iter()
            .find(|workspace| workspace.id == payload.workspace_id)
            .map(|workspace| workspace.path.clone())
            .context("workspace not found")
            .map_err(|error| error.to_string())?
    };

    if let Ok(Some(undo_checkpoint)) = git::capture_undo_checkpoint(
        &payload.workspace_id,
        &payload.session_id,
        &payload.user_message_id,
        &workspace_path,
    ) {
        let _ = storage::save_undo_checkpoint(&app, &undo_checkpoint);
    }

    git::restore_undo_checkpoint(&workspace_path, &checkpoint)
        .map_err(|error| error.to_string())?;
    let _ = storage::delete_redo_checkpoint(
        &app,
        &payload.workspace_id,
        &payload.session_id,
        &payload.user_message_id,
    );

    Ok(shared.state.lock().await.clone())
}

#[tauri::command]
async fn get_session_stats(
    shared: State<'_, AppState>,
    payload: SessionIdentityPayload,
) -> Result<models::SessionStats, String> {
    pi::get_session_stats(shared.inner().clone(), payload)
        .await
        .map_err(|error| error.to_string())
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
async fn move_workspace(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: ReorderWorkspacePayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    let Some(source_index) = state
        .workspaces
        .iter()
        .position(|workspace| workspace.id == payload.workspace_id)
    else {
        return Err("workspace not found".to_string());
    };

    let target_index = payload
        .before_workspace_id
        .as_ref()
        .and_then(|workspace_id| {
            state
                .workspaces
                .iter()
                .position(|workspace| workspace.id == *workspace_id)
        });

    if target_index == Some(source_index) {
        return Ok(state.clone());
    }

    let workspace = state.workspaces.remove(source_index);
    let insert_index = match target_index {
        Some(index) if index > source_index => index - 1,
        Some(index) => index,
        None => state.workspaces.len(),
    };
    state.workspaces.insert(insert_index, workspace);
    storage::save(&app, &state).map_err(|error| error.to_string())?;
    Ok(state.clone())
}

#[tauri::command]
async fn move_session(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: ReorderSessionPayload,
) -> Result<PersistedAppState, String> {
    let mut state = shared.state.lock().await;
    let Some(workspace) = state
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == payload.workspace_id)
    else {
        return Err("workspace not found".to_string());
    };

    let Some(source_index) = workspace
        .sessions
        .iter()
        .position(|session| session.id == payload.session_id)
    else {
        return Err("session not found".to_string());
    };

    let target_index = payload.before_session_id.as_ref().and_then(|session_id| {
        workspace
            .sessions
            .iter()
            .position(|session| session.id == *session_id)
    });

    if target_index == Some(source_index) {
        return Ok(state.clone());
    }

    let session = workspace.sessions.remove(source_index);
    let insert_index = match target_index {
        Some(index) if index > source_index => index - 1,
        Some(index) => index,
        None => workspace.sessions.len(),
    };
    workspace.sessions.insert(insert_index, session);
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

#[tauri::command]
async fn ensure_terminal_session(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: EnsureTerminalSessionPayload,
) -> Result<(), String> {
    let workspace_path = {
        let state = shared.state.lock().await;
        state
            .workspaces
            .iter()
            .find(|workspace| workspace.id == payload.workspace_id)
            .map(|workspace| workspace.path.clone())
            .context("workspace not found")
            .map_err(|error| error.to_string())?
    };

    shared
        .terminal
        .ensure_session(
            app,
            payload.workspace_id,
            payload.terminal_tab_id,
            workspace_path,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn close_terminal_session(
    shared: State<'_, AppState>,
    payload: CloseTerminalSessionPayload,
) -> Result<(), String> {
    shared
        .terminal
        .close_session(&payload.workspace_id, &payload.terminal_tab_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn write_terminal_input(
    shared: State<'_, AppState>,
    payload: WriteTerminalInputPayload,
) -> Result<(), String> {
    shared
        .terminal
        .write_input(
            &payload.workspace_id,
            &payload.terminal_tab_id,
            &payload.data,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn resize_terminal(
    shared: State<'_, AppState>,
    payload: ResizeTerminalPayload,
) -> Result<(), String> {
    shared
        .terminal
        .resize(
            &payload.workspace_id,
            &payload.terminal_tab_id,
            payload.cols,
            payload.rows,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_terminal_command(
    app: AppHandle,
    shared: State<'_, AppState>,
    payload: RunTerminalCommandPayload,
) -> Result<RunTerminalCommandResult, String> {
    let workspace_path = {
        let state = shared.state.lock().await;
        state
            .workspaces
            .iter()
            .find(|workspace| workspace.id == payload.workspace_id)
            .map(|workspace| workspace.path.clone())
            .context("workspace not found")
            .map_err(|error| error.to_string())?
    };

    shared
        .terminal
        .ensure_session(
            app,
            payload.workspace_id.clone(),
            payload.terminal_tab_id.clone(),
            workspace_path,
        )
        .map_err(|error| error.to_string())?;

    shared
        .terminal
        .run_command(
            &payload.workspace_id,
            &payload.terminal_tab_id,
            payload.command,
            payload.refresh_git,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn write_text_file(payload: WriteTextFilePayload) -> Result<(), String> {
    std::fs::write(payload.path, payload.content).map_err(|error| error.to_string())
}

fn load_initial_state(app: &AppHandle) -> anyhow::Result<PersistedAppState> {
    if let Some(state) = storage::load(app)? {
        let mut state = normalize_state(state);
        pi::reconcile_persisted_state(&mut state);
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

fn install_app_menu(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let services = SubmenuBuilder::new(handle, "Services")
        .text(CHECK_FOR_UPDATES_MENU_ID, "Check for Updates")
        .build()?;
    let app_menu = SubmenuBuilder::new(handle, "picode")
        .about(None)
        .separator()
        .item(&services)
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(handle, "File").close_window().build()?;
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(handle, "View").fullscreen().build()?;
    let menu = MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

fn show_update_message(app: &AppHandle, title: &str, message: String, kind: MessageDialogKind) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .show(|_| {});
}

fn handle_check_for_updates_menu(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let channel = match app.state::<AppState>().state.try_lock() {
            Ok(state) => state.preferences.update_channel.clone(),
            Err(_) => "stable".to_string(),
        };

        match check_app_update(&app, Some(&channel)).await {
            Ok(result) if result.status == "up-to-date" => show_update_message(
                &app,
                "picode is up to date",
                format!(
                    "picode {} is up to date on {channel}.",
                    result.current_version
                ),
                MessageDialogKind::Info,
            ),
            Ok(result) if result.status == "no-release" => show_update_message(
                &app,
                "No updates yet",
                format!(
                    "No updates for picode {} on {channel} yet!",
                    result.current_version
                ),
                MessageDialogKind::Info,
            ),
            Ok(result) => {
                let latest = result.latest_version.unwrap_or_default();
                match do_install_app_update(&app, Some(&channel)).await {
                    Ok(_) => show_update_message(
                        &app,
                        "Update installed",
                        format!(
                            "picode {latest} was installed from {channel}. Restart picode to finish updating."
                        ),
                        MessageDialogKind::Info,
                    ),
                    Err(error) => {
                        show_update_message(&app, "Update failed", error, MessageDialogKind::Error)
                    }
                }
            }
            Err(error) => {
                show_update_message(&app, "Update failed", error, MessageDialogKind::Error)
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let state = load_initial_state(app.handle())?;
            app.manage(AppState::new(state));
            install_app_menu(app)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == CHECK_FOR_UPDATES_MENU_ID {
                handle_check_for_updates_menu(app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap_state,
            app_paths,
            check_for_app_update,
            install_app_update,
            restart_app,
            create_workspace,
            create_session,
            select_workspace_session,
            update_preferences,
            update_workspace_settings,
            refresh_git_snapshot,
            prepare_git_action,
            initialize_git_repository,
            run_git_action,
            send_prompt,
            resolve_extension_ui_request,
            get_session_stats,
            resolve_approval,
            undo_user_turn,
            redo_user_turn,
            move_workspace,
            move_session,
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
            open_path,
            ensure_terminal_session,
            close_terminal_session,
            write_terminal_input,
            resize_terminal,
            run_terminal_command,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running picode");
}
