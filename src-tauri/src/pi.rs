use crate::models::{
    AbortPromptPayload, ApprovalDecision, ApprovalRequest, ApprovalState, PiRuntimeEvent,
    ProviderAuthPayload, ProviderOption, ResolveApprovalPayload, RuntimeBootstrapPayload,
    RuntimeHealthPayload, SaveApiKeyPayload, SendPromptPayload, SessionRuntimeMetadata,
    SessionStatus, SubmitRuntimeInputPayload, TimelineItem, ToolActivity, ToolStatus,
    normalize_state, now_iso,
};
use crate::{AppState, storage};
use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};
use tokio::sync::{Mutex, oneshot};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogResponse {
    providers: Vec<ProviderOption>,
}

#[derive(Clone)]
pub struct PiRuntimeHandle {
    inner: Arc<PiRuntimeInner>,
}

struct PiRuntimeInner {
    child: Mutex<Option<CommandChild>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    counter: AtomicU64,
}

impl PiRuntimeHandle {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(PiRuntimeInner {
                child: Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                counter: AtomicU64::new(1),
            }),
        }
    }

    fn next_request_id(&self) -> String {
        format!(
            "runtime-{}",
            self.inner.counter.fetch_add(1, Ordering::Relaxed)
        )
    }

    async fn clear_child(&self) {
        let mut child = self.inner.child.lock().await;
        *child = None;
    }

    async fn fail_pending(&self, message: &str) {
        let mut pending = self.inner.pending.lock().await;
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(message.to_string()));
        }
    }

    async fn ensure_started(&self, app: &AppHandle, shared: AppState) -> Result<()> {
        let mut child = self.inner.child.lock().await;
        if child.is_some() {
            return Ok(());
        }

        let (mut receiver, command_child) = app
            .shell()
            .sidecar("bin/pi-runtime")
            .map_err(|error| anyhow!(error.to_string()))?
            .spawn()
            .map_err(|error| anyhow!(error.to_string()))?;

        *child = Some(command_child);
        drop(child);

        let runtime = self.clone();
        let app_handle = app.clone();
        tokio::spawn(async move {
            while let Some(event) = receiver.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        if let Ok(text) = String::from_utf8(line) {
                            let _ = runtime
                                .dispatch_stdout_line(&app_handle, shared.clone(), text)
                                .await;
                        }
                    }
                    CommandEvent::Stderr(line) => {
                        if let Ok(text) = String::from_utf8(line) {
                            let _ = app_handle.emit(
                                "pi://event",
                                PiRuntimeEvent::Status {
                                    workspace_id: None,
                                    session_id: None,
                                    label: "Pi runtime".to_string(),
                                    detail: Some(text),
                                },
                            );
                        }
                    }
                    CommandEvent::Error(error) => {
                        runtime.clear_child().await;
                        runtime.fail_pending(&error).await;
                        let _ = app_handle.emit(
                            "pi://event",
                            PiRuntimeEvent::Error {
                                workspace_id: None,
                                session_id: None,
                                message: error,
                                metadata: None,
                            },
                        );
                    }
                    CommandEvent::Terminated(payload) => {
                        runtime.clear_child().await;
                        runtime
                            .fail_pending("The Pi runtime process terminated.")
                            .await;
                        let _ = app_handle.emit(
                            "pi://event",
                            PiRuntimeEvent::Error {
                                workspace_id: None,
                                session_id: None,
                                message: format!(
                                    "The Pi runtime terminated{}.",
                                    payload
                                        .code
                                        .map(|code| format!(" with exit code {code}"))
                                        .unwrap_or_default()
                                ),
                                metadata: None,
                            },
                        );
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    async fn dispatch_stdout_line(
        &self,
        app: &AppHandle,
        shared: AppState,
        line: String,
    ) -> Result<()> {
        let envelope = serde_json::from_str::<SidecarEnvelope>(&line)
            .with_context(|| format!("failed to parse sidecar envelope: {line}"))?;

        match envelope {
            SidecarEnvelope::Response {
                request_id,
                success,
                payload,
                error,
            } => {
                let sender = self.inner.pending.lock().await.remove(&request_id);
                if let Some(sender) = sender {
                    let _ = if success {
                        sender.send(Ok(payload.unwrap_or(Value::Null)))
                    } else {
                        sender.send(Err(
                            error.unwrap_or_else(|| "Sidecar request failed.".to_string())
                        ))
                    };
                }
            }
            SidecarEnvelope::Event { event } => {
                handle_sidecar_event(app, &shared, event).await?;
            }
        }

        Ok(())
    }

    async fn request<P, R>(
        &self,
        app: &AppHandle,
        shared: AppState,
        command: &str,
        payload: &P,
    ) -> Result<R>
    where
        P: Serialize + ?Sized,
        R: DeserializeOwned,
    {
        self.ensure_started(app, shared).await?;

        let request_id = self.next_request_id();
        let (tx, rx) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .await
            .insert(request_id.clone(), tx);

        let command_line = serde_json::to_string(&SidecarCommandEnvelope {
            id: request_id.clone(),
            command: command.to_string(),
            payload,
        })?;

        {
            let mut child = self.inner.child.lock().await;
            let sidecar = child
                .as_mut()
                .context("Pi runtime process is not available")?;
            sidecar
                .write(format!("{command_line}\n").as_bytes())
                .map_err(|error| anyhow!(error.to_string()))?;
        }

        let response = rx
            .await
            .context("Pi runtime response channel was dropped")?
            .map_err(|error| anyhow!(error))?;
        Ok(serde_json::from_value(response)?)
    }
}

#[derive(Serialize)]
struct SidecarCommandEnvelope<'a, P: ?Sized> {
    id: String,
    command: String,
    payload: &'a P,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum SidecarEnvelope {
    Response {
        #[serde(rename = "requestId")]
        request_id: String,
        success: bool,
        payload: Option<Value>,
        error: Option<String>,
    },
    Event {
        event: SidecarEvent,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SidecarEvent {
    RuntimeReady {
        #[serde(rename = "piHome")]
        pi_home: String,
        version: Option<String>,
    },
    Catalog {
        providers: Vec<ProviderOption>,
    },
    Status {
        #[serde(rename = "workspaceId")]
        workspace_id: Option<String>,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        label: String,
        detail: Option<String>,
    },
    Token {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        delta: String,
        metadata: Option<SessionRuntimeMetadata>,
    },
    ToolStart {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        activity: ToolActivity,
    },
    ToolUpdate {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "activityId")]
        activity_id: String,
        output: String,
        status: ToolStatus,
    },
    ToolEnd {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "activityId")]
        activity_id: String,
        output: String,
        status: ToolStatus,
    },
    ApprovalRequested {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        approval: ApprovalRequest,
    },
    ApprovalResolved {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "approvalId")]
        approval_id: String,
        decision: ApprovalDecision,
        summary: String,
    },
    Done {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        content: String,
        metadata: Option<SessionRuntimeMetadata>,
    },
    Error {
        #[serde(rename = "workspaceId")]
        workspace_id: Option<String>,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        message: String,
        metadata: Option<SessionRuntimeMetadata>,
    },
    AuthBrowserOpen {
        #[serde(rename = "providerId")]
        provider_id: String,
        url: String,
        instructions: Option<String>,
    },
    AuthManualInputRequested {
        #[serde(rename = "providerId")]
        provider_id: String,
        #[serde(rename = "requestId")]
        request_id: String,
        title: String,
        message: String,
        placeholder: Option<String>,
        kind: String,
    },
    AuthCompleted {
        #[serde(rename = "providerId")]
        provider_id: String,
    },
    AuthFailed {
        #[serde(rename = "providerId")]
        provider_id: String,
        message: String,
    },
}

fn upsert_tool_activity(session: &mut crate::models::ChatSession, activity: ToolActivity) {
    if let Some(existing) = session.timeline.iter_mut().find(|item| {
        matches!(
            item,
            TimelineItem::ToolActivity {
                activity: existing, ..
            } if existing.id == activity.id
        )
    }) {
        if let TimelineItem::ToolActivity {
            activity: existing, ..
        } = existing
        {
            *existing = activity;
        }
    } else {
        session.timeline.push(TimelineItem::ToolActivity {
            id: activity.id.clone(),
            created_at: activity.started_at.clone(),
            activity,
        });
    }
}

fn apply_metadata(
    session: &mut crate::models::ChatSession,
    metadata: Option<SessionRuntimeMetadata>,
) {
    if let Some(metadata) = metadata {
        if metadata.provider_id.is_some() {
            session.runtime.provider_id = metadata.provider_id;
        }
        if metadata.model_id.is_some() {
            session.runtime.model_id = metadata.model_id;
        }
        if metadata.pi_session_file.is_some() {
            session.runtime.pi_session_file = metadata.pi_session_file;
        }
        session.runtime.last_known_ready = metadata.last_known_ready;
        if metadata.last_error.is_some() {
            session.runtime.last_error = metadata.last_error;
        }
    }
}

fn find_session_mut<'a>(
    state: &'a mut crate::models::PersistedAppState,
    workspace_id: &str,
    session_id: &str,
) -> Option<&'a mut crate::models::ChatSession> {
    state
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
        .and_then(|workspace| {
            workspace
                .sessions
                .iter_mut()
                .find(|session| session.id == session_id)
        })
}

async fn handle_sidecar_event(
    app: &AppHandle,
    shared: &AppState,
    event: SidecarEvent,
) -> Result<()> {
    let frontend_event = match event.clone() {
        SidecarEvent::RuntimeReady { pi_home, version } => {
            PiRuntimeEvent::RuntimeReady { pi_home, version }
        }
        SidecarEvent::Catalog { providers } => {
            let mut state = shared.state.lock().await;
            state.providers = providers.clone();
            *state = normalize_state(state.clone());
            storage::save(app, &state)?;
            PiRuntimeEvent::Catalog { providers }
        }
        SidecarEvent::Status {
            workspace_id,
            session_id,
            label,
            detail,
        } => {
            if let (Some(workspace_id), Some(session_id)) = (&workspace_id, &session_id) {
                let mut state = shared.state.lock().await;
                if let Some(session) = find_session_mut(&mut state, workspace_id, session_id) {
                    session.timeline.push(TimelineItem::SystemNotice {
                        id: Uuid::new_v4().to_string(),
                        created_at: now_iso(),
                        title: label.clone(),
                        detail: detail.clone().unwrap_or_default(),
                    });
                    if label == "Aborted" {
                        session.status = SessionStatus::Idle;
                    }
                    session.updated_at = now_iso();
                    storage::save(app, &state)?;
                }
            }

            PiRuntimeEvent::Status {
                workspace_id,
                session_id,
                label,
                detail,
            }
        }
        SidecarEvent::Token {
            workspace_id,
            session_id,
            delta,
            metadata,
        } => PiRuntimeEvent::Token {
            workspace_id,
            session_id,
            delta,
            metadata,
        },
        SidecarEvent::ToolStart {
            workspace_id,
            session_id,
            activity,
        } => {
            let mut state = shared.state.lock().await;
            if let Some(session) = find_session_mut(&mut state, &workspace_id, &session_id) {
                session.status = SessionStatus::Streaming;
                upsert_tool_activity(session, activity.clone());
                session.updated_at = now_iso();
                storage::save(app, &state)?;
            }

            PiRuntimeEvent::ToolStart {
                workspace_id,
                session_id,
                activity,
            }
        }
        SidecarEvent::ToolUpdate {
            workspace_id,
            session_id,
            activity_id,
            output,
            status,
        }
        | SidecarEvent::ToolEnd {
            workspace_id,
            session_id,
            activity_id,
            output,
            status,
        } => {
            let mut state = shared.state.lock().await;
            if let Some(session) = find_session_mut(&mut state, &workspace_id, &session_id) {
                if let Some(TimelineItem::ToolActivity { activity, .. }) =
                    session.timeline.iter_mut().find(|entry| {
                        matches!(
                            entry,
                            TimelineItem::ToolActivity {
                                activity: existing,
                                ..
                            } if existing.id == activity_id
                        )
                    })
                {
                    activity.output = Some(output.clone());
                    activity.status = status.clone();
                }
                session.updated_at = now_iso();
                storage::save(app, &state)?;
            }

            PiRuntimeEvent::ToolOutput {
                workspace_id,
                session_id,
                activity_id,
                output,
                status,
            }
        }
        SidecarEvent::ApprovalRequested {
            workspace_id,
            session_id,
            approval,
        } => {
            let mut state = shared.state.lock().await;
            if let Some(session) = find_session_mut(&mut state, &workspace_id, &session_id) {
                session.timeline.push(TimelineItem::ApprovalRequest {
                    id: approval.id.clone(),
                    created_at: approval.requested_at.clone(),
                    approval: approval.clone(),
                });
                session.status = SessionStatus::AwaitingApproval;
                session.updated_at = now_iso();
                storage::save(app, &state)?;
            }

            PiRuntimeEvent::ApprovalRequested {
                workspace_id,
                session_id,
                approval,
            }
        }
        SidecarEvent::ApprovalResolved {
            workspace_id,
            session_id,
            approval_id,
            decision,
            summary,
        } => {
            let mut state = shared.state.lock().await;
            if let Some(session) = find_session_mut(&mut state, &workspace_id, &session_id) {
                for item in &mut session.timeline {
                    if let TimelineItem::ApprovalRequest { approval, .. } = item {
                        if approval.id == approval_id {
                            approval.status = match decision {
                                ApprovalDecision::Approved => ApprovalState::Approved,
                                ApprovalDecision::Rejected => ApprovalState::Rejected,
                            };
                        }
                    }
                }
                session.timeline.push(TimelineItem::ApprovalResolution {
                    id: Uuid::new_v4().to_string(),
                    created_at: now_iso(),
                    approval_id: approval_id.clone(),
                    decision: decision.clone(),
                    summary: summary.clone(),
                });
                session.status = SessionStatus::Idle;
                session.updated_at = now_iso();
                storage::save(app, &state)?;
            }

            PiRuntimeEvent::ApprovalResolved {
                workspace_id,
                session_id,
                approval_id,
                decision,
                summary,
            }
        }
        SidecarEvent::Done {
            workspace_id,
            session_id,
            content,
            metadata,
        } => {
            let mut state = shared.state.lock().await;
            if let Some(session) = find_session_mut(&mut state, &workspace_id, &session_id) {
                session.timeline.push(TimelineItem::AssistantMessage {
                    id: Uuid::new_v4().to_string(),
                    created_at: now_iso(),
                    content: content.clone(),
                    streaming: false,
                });
                session.status = SessionStatus::Idle;
                apply_metadata(session, metadata.clone());
                session.runtime.last_known_ready = true;
                session.runtime.last_error = None;
                session.updated_at = now_iso();
                storage::save(app, &state)?;
            }

            PiRuntimeEvent::Done {
                workspace_id,
                session_id,
                content,
                metadata,
            }
        }
        SidecarEvent::Error {
            workspace_id,
            session_id,
            message,
            metadata,
        } => {
            if let (Some(workspace_id), Some(session_id)) = (&workspace_id, &session_id) {
                let mut state = shared.state.lock().await;
                if let Some(session) = find_session_mut(&mut state, workspace_id, session_id) {
                    session.timeline.push(TimelineItem::Error {
                        id: Uuid::new_v4().to_string(),
                        created_at: now_iso(),
                        title: "Runtime error".to_string(),
                        detail: message.clone(),
                    });
                    session.status = SessionStatus::Error;
                    apply_metadata(session, metadata.clone());
                    session.runtime.last_error = Some(message.clone());
                    session.updated_at = now_iso();
                    storage::save(app, &state)?;
                }
            }

            PiRuntimeEvent::Error {
                workspace_id,
                session_id,
                message,
                metadata,
            }
        }
        SidecarEvent::AuthBrowserOpen {
            provider_id,
            url,
            instructions,
        } => PiRuntimeEvent::AuthBrowserOpen {
            provider_id,
            url,
            instructions,
        },
        SidecarEvent::AuthManualInputRequested {
            provider_id,
            request_id,
            title,
            message,
            placeholder,
            kind,
        } => PiRuntimeEvent::AuthManualInputRequested {
            provider_id,
            request_id,
            title,
            message,
            placeholder,
            kind,
        },
        SidecarEvent::AuthCompleted { provider_id } => {
            PiRuntimeEvent::AuthCompleted { provider_id }
        }
        SidecarEvent::AuthFailed {
            provider_id,
            message,
        } => PiRuntimeEvent::AuthFailed {
            provider_id,
            message,
        },
    };

    app.emit("pi://event", frontend_event)?;
    Ok(())
}

fn merge_providers_into_state(
    state: &mut crate::models::PersistedAppState,
    providers: Vec<ProviderOption>,
) {
    state.providers = providers;
    *state = normalize_state(state.clone());
}

async fn ensure_runtime_ready(
    app: &AppHandle,
    shared: AppState,
) -> Result<RuntimeBootstrapPayload> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data directory")?
        .display()
        .to_string();

    let payload = shared
        .runtime
        .request::<_, RuntimeBootstrapPayload>(
            app,
            shared.clone(),
            "bootstrap",
            &json!({ "appDataDir": app_data_dir }),
        )
        .await?;

    {
        let mut state = shared.state.lock().await;
        merge_providers_into_state(&mut state, payload.providers.clone());
        storage::save(app, &state)?;
    }

    Ok(payload)
}

pub async fn bootstrap_runtime(
    app: AppHandle,
    shared: AppState,
) -> Result<RuntimeBootstrapPayload> {
    ensure_runtime_ready(&app, shared).await
}

pub async fn refresh_runtime_catalog(
    app: AppHandle,
    shared: AppState,
) -> Result<RuntimeBootstrapPayload> {
    let bootstrap = ensure_runtime_ready(&app, shared.clone()).await?;
    let catalog: CatalogResponse = shared
        .runtime
        .request::<_, CatalogResponse>(&app, shared.clone(), "refresh_catalog", &json!({}))
        .await?;

    {
        let mut state = shared.state.lock().await;
        merge_providers_into_state(&mut state, catalog.providers.clone());
        storage::save(&app, &state)?;
    }

    Ok(RuntimeBootstrapPayload {
        pi_home: bootstrap.pi_home,
        version: bootstrap.version,
        providers: catalog.providers,
    })
}

pub async fn healthcheck(app: AppHandle, shared: AppState) -> Result<RuntimeHealthPayload> {
    let _ = ensure_runtime_ready(&app, shared.clone()).await?;
    shared
        .runtime
        .request::<_, RuntimeHealthPayload>(&app, shared.clone(), "healthcheck", &json!({}))
        .await
}

pub async fn sync_workspace_policy(
    app: &AppHandle,
    shared: AppState,
    workspace_id: &str,
) -> Result<()> {
    let _ = ensure_runtime_ready(app, shared.clone()).await?;
    let payload = {
        let state = shared.state.lock().await;
        let workspace = state
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
            .context("workspace not found")?;
        json!({
            "workspaceId": workspace.id,
            "cwd": workspace.path,
            "approvalMode": workspace.approval_mode,
            "policy": workspace.policy,
        })
    };

    let _: Value = shared
        .runtime
        .request(app, shared.clone(), "set_workspace_policy", &payload)
        .await?;
    Ok(())
}

pub async fn launch_prompt_stream(
    app: AppHandle,
    shared: AppState,
    payload: SendPromptPayload,
) -> Result<()> {
    let _ = ensure_runtime_ready(&app, shared.clone()).await?;

    let workspace_path;
    let approval_mode;
    let policy;
    let provider_id;
    let model_id;
    let effort;

    {
        let mut state = shared.state.lock().await;
        let workspace = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == payload.workspace_id)
            .context("workspace not found")?;
        let session = workspace
            .sessions
            .iter_mut()
            .find(|session| session.id == payload.session_id)
            .context("session not found")?;

        workspace_path = workspace.path.clone();
        approval_mode = workspace.approval_mode.clone();
        policy = workspace.policy.clone();
        provider_id = workspace.provider_id.clone();
        model_id = workspace.model_id.clone();
        effort = workspace.effort.clone();

        session.timeline.push(TimelineItem::UserMessage {
            id: Uuid::new_v4().to_string(),
            created_at: now_iso(),
            content: payload.prompt.clone(),
        });
        session.status = SessionStatus::Streaming;
        session.updated_at = now_iso();
        storage::save(&app, &state)?;
    }

    let runtime_info: SessionRuntimeMetadata = shared
        .runtime
        .request(
            &app,
            shared.clone(),
            "create_or_resume_session",
            &json!({
                "workspaceId": payload.workspace_id,
                "sessionId": payload.session_id,
                "cwd": workspace_path,
                "providerId": provider_id,
                "modelId": model_id,
                "effort": effort,
                "approvalMode": approval_mode,
                "policy": policy,
            }),
        )
        .await?;

    {
        let mut state = shared.state.lock().await;
        if let Some(workspace) = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == payload.workspace_id)
        {
            workspace.provider_id = runtime_info
                .provider_id
                .clone()
                .unwrap_or_else(|| workspace.provider_id.clone());
            workspace.model_id = runtime_info
                .model_id
                .clone()
                .unwrap_or_else(|| workspace.model_id.clone());
            if let Some(session) = workspace
                .sessions
                .iter_mut()
                .find(|session| session.id == payload.session_id)
            {
                apply_metadata(session, Some(runtime_info.clone()));
                session.runtime.last_known_ready = true;
            }
            storage::save(&app, &state)?;
        }
    }

    let _: Value = shared
        .runtime
        .request(
            &app,
            shared.clone(),
            "prompt",
            &json!({
                "workspaceId": payload.workspace_id,
                "sessionId": payload.session_id,
                "prompt": payload.prompt,
                "providerId": runtime_info.provider_id.unwrap_or(provider_id),
                "modelId": runtime_info.model_id.unwrap_or(model_id),
                "effort": effort,
            }),
        )
        .await?;

    Ok(())
}

pub async fn start_provider_login(
    app: AppHandle,
    shared: AppState,
    payload: ProviderAuthPayload,
) -> Result<RuntimeBootstrapPayload> {
    let bootstrap = ensure_runtime_ready(&app, shared.clone()).await?;
    let catalog: CatalogResponse = shared
        .runtime
        .request(
            &app,
            shared.clone(),
            "login_oauth",
            &json!({ "providerId": payload.provider_id }),
        )
        .await?;

    {
        let mut state = shared.state.lock().await;
        merge_providers_into_state(&mut state, catalog.providers.clone());
        storage::save(&app, &state)?;
    }

    Ok(RuntimeBootstrapPayload {
        pi_home: bootstrap.pi_home,
        version: bootstrap.version,
        providers: catalog.providers,
    })
}

pub async fn save_provider_api_key(
    app: AppHandle,
    shared: AppState,
    payload: SaveApiKeyPayload,
) -> Result<RuntimeBootstrapPayload> {
    let bootstrap = ensure_runtime_ready(&app, shared.clone()).await?;
    let catalog: CatalogResponse = shared
        .runtime
        .request(
            &app,
            shared.clone(),
            "save_api_key",
            &json!({
                "providerId": payload.provider_id,
                "apiKey": payload.api_key,
            }),
        )
        .await?;

    {
        let mut state = shared.state.lock().await;
        merge_providers_into_state(&mut state, catalog.providers.clone());
        storage::save(&app, &state)?;
    }

    Ok(RuntimeBootstrapPayload {
        pi_home: bootstrap.pi_home,
        version: bootstrap.version,
        providers: catalog.providers,
    })
}

pub async fn logout_provider(
    app: AppHandle,
    shared: AppState,
    payload: ProviderAuthPayload,
) -> Result<RuntimeBootstrapPayload> {
    let bootstrap = ensure_runtime_ready(&app, shared.clone()).await?;
    let catalog: CatalogResponse = shared
        .runtime
        .request(
            &app,
            shared.clone(),
            "logout_provider",
            &json!({ "providerId": payload.provider_id }),
        )
        .await?;

    {
        let mut state = shared.state.lock().await;
        merge_providers_into_state(&mut state, catalog.providers.clone());
        storage::save(&app, &state)?;
    }

    Ok(RuntimeBootstrapPayload {
        pi_home: bootstrap.pi_home,
        version: bootstrap.version,
        providers: catalog.providers,
    })
}

pub async fn submit_runtime_input(
    app: AppHandle,
    shared: AppState,
    payload: SubmitRuntimeInputPayload,
) -> Result<()> {
    let _ = ensure_runtime_ready(&app, shared.clone()).await?;
    let _: Value = shared
        .runtime
        .request(
            &app,
            shared.clone(),
            "respond_ui_request",
            &json!({
                "requestId": payload.request_id,
                "value": payload.value,
                "confirmed": payload.confirmed,
                "cancelled": payload.cancelled,
            }),
        )
        .await?;
    Ok(())
}

pub async fn resolve_approval(
    app: AppHandle,
    shared: AppState,
    payload: ResolveApprovalPayload,
) -> Result<()> {
    submit_runtime_input(
        app,
        shared,
        SubmitRuntimeInputPayload {
            request_id: payload.approval_id,
            value: None,
            confirmed: Some(matches!(payload.decision, ApprovalDecision::Approved)),
            cancelled: None,
        },
    )
    .await
}

pub async fn abort_prompt(
    app: AppHandle,
    shared: AppState,
    payload: AbortPromptPayload,
) -> Result<crate::models::PersistedAppState> {
    let _ = ensure_runtime_ready(&app, shared.clone()).await?;
    let _: Value = shared
        .runtime
        .request(
            &app,
            shared.clone(),
            "abort",
            &json!({
                "workspaceId": payload.workspace_id,
                "sessionId": payload.session_id,
            }),
        )
        .await?;
    Ok(shared.state.lock().await.clone())
}
