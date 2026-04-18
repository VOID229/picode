use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalMode {
    #[serde(alias = "ask-first")]
    Supervised,
    AutoAcceptEdits,
    FullAccess,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalPolicy {
    pub allowed_paths: Vec<String>,
    pub allowed_commands: Vec<String>,
    pub env_passthrough: Vec<String>,
    pub network_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOption {
    pub id: String,
    pub label: String,
    #[serde(default = "default_provider_status")]
    pub status: ProviderStatus,
    #[serde(default = "default_provider_auth_kind")]
    pub auth_kind: ProviderAuthKind,
    #[serde(default)]
    pub available: bool,
    #[serde(default)]
    pub reason: Option<String>,
    pub models: Vec<ModelOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub label: String,
    pub provider_id: String,
    pub context_window: String,
    #[serde(default)]
    pub available: bool,
    #[serde(default = "default_provider_source")]
    pub provider_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderStatus {
    Ready,
    RequiresOauth,
    RequiresApiKey,
    RequiresLocalRuntime,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderAuthKind {
    Oauth,
    ApiKey,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum TimelineItem {
    UserMessage {
        id: String,
        created_at: String,
        content: String,
    },
    AssistantMessage {
        id: String,
        created_at: String,
        content: String,
        streaming: bool,
    },
    ToolActivity {
        id: String,
        created_at: String,
        activity: ToolActivity,
    },
    ApprovalRequest {
        id: String,
        created_at: String,
        approval: ApprovalRequest,
    },
    ApprovalResolution {
        id: String,
        created_at: String,
        approval_id: String,
        decision: ApprovalDecision,
        summary: String,
    },
    Warning {
        id: String,
        created_at: String,
        title: String,
        detail: String,
    },
    Error {
        id: String,
        created_at: String,
        title: String,
        detail: String,
    },
    SystemNotice {
        id: String,
        created_at: String,
        title: String,
        detail: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolActivity {
    pub id: String,
    pub tool_name: String,
    pub summary: String,
    pub output: Option<String>,
    pub status: ToolStatus,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub title: String,
    pub reason: String,
    pub command: Option<String>,
    pub path: Option<String>,
    pub diff_preview: Option<String>,
    pub risk: RiskLevel,
    pub status: ApprovalState,
    pub requested_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalState {
    Pending,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalDecision {
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub branch_label: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub status: SessionStatus,
    #[serde(default)]
    pub runtime: SessionRuntimeMetadata,
    pub timeline: Vec<TimelineItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionRuntimeMetadata {
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub pi_session_file: Option<String>,
    #[serde(default)]
    pub last_known_ready: bool,
    #[serde(default)]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionStatus {
    Idle,
    Streaming,
    AwaitingApproval,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub pinned: bool,
    pub recent_rank: i64,
    pub approval_mode: ApprovalMode,
    pub policy: ApprovalPolicy,
    #[serde(default = "default_provider_id")]
    pub provider_id: String,
    #[serde(default = "default_model_id")]
    pub model_id: String,
    #[serde(default = "default_effort")]
    pub effort: String,
    #[serde(default = "default_fast_mode")]
    pub fast_mode: bool,
    pub sessions: Vec<ChatSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub patch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSnapshot {
    pub branch: String,
    pub summary: String,
    pub is_repo: bool,
    pub dirty: bool,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub files: Vec<DiffFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutPreferences {
    pub diff_mode: String,
    pub git_panel_open: bool,
    pub diff_panel_open: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub theme: String,
    #[serde(default = "default_provider_id")]
    pub provider_id: String,
    #[serde(default = "default_model_id")]
    pub model_id: String,
    pub approval_mode: ApprovalMode,
    #[serde(default = "default_effort")]
    pub effort: String,
    #[serde(default = "default_fast_mode")]
    pub fast_mode: bool,
    pub layout: LayoutPreferences,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAppState {
    pub schema_version: u32,
    pub active_workspace_id: Option<String>,
    pub active_session_id: Option<String>,
    pub workspaces: Vec<WorkspaceRecord>,
    pub preferences: AppPreferences,
    pub providers: Vec<ProviderOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
    pub state: PersistedAppState,
    pub git: std::collections::HashMap<String, GitSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBootstrapPayload {
    pub pi_home: String,
    pub version: Option<String>,
    pub providers: Vec<ProviderOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealthPayload {
    pub ready: bool,
    pub version: Option<String>,
    pub pi_home: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspacePayload {
    pub path: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionPayload {
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectWorkspaceSessionPayload {
    pub workspace_id: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkspaceSettingsPayload {
    pub workspace_id: String,
    pub approval_mode: ApprovalMode,
    pub provider_id: String,
    pub model_id: String,
    pub effort: Option<String>,
    pub fast_mode: Option<bool>,
    pub policy: ApprovalPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendPromptPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveApprovalPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub approval_id: String,
    pub decision: ApprovalDecision,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameWorkspacePayload {
    pub workspace_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveWorkspacePayload {
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSessionPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionPayload {
    pub workspace_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshGitPayload {
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthPayload {
    pub provider_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveApiKeyPayload {
    pub provider_id: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitRuntimeInputPayload {
    pub request_id: String,
    pub value: Option<String>,
    pub confirmed: Option<bool>,
    pub cancelled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbortPromptPayload {
    pub workspace_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum PiRuntimeEvent {
    RuntimeReady {
        pi_home: String,
        version: Option<String>,
    },
    Catalog {
        providers: Vec<ProviderOption>,
    },
    Token {
        workspace_id: String,
        session_id: String,
        delta: String,
        metadata: Option<SessionRuntimeMetadata>,
    },
    ToolStart {
        workspace_id: String,
        session_id: String,
        activity: ToolActivity,
    },
    ToolOutput {
        workspace_id: String,
        session_id: String,
        activity_id: String,
        output: String,
        status: ToolStatus,
    },
    ApprovalRequested {
        workspace_id: String,
        session_id: String,
        approval: ApprovalRequest,
    },
    ApprovalResolved {
        workspace_id: String,
        session_id: String,
        approval_id: String,
        decision: ApprovalDecision,
        summary: String,
    },
    Status {
        workspace_id: Option<String>,
        session_id: Option<String>,
        label: String,
        detail: Option<String>,
    },
    Error {
        workspace_id: Option<String>,
        session_id: Option<String>,
        message: String,
        metadata: Option<SessionRuntimeMetadata>,
    },
    Done {
        workspace_id: String,
        session_id: String,
        content: String,
        metadata: Option<SessionRuntimeMetadata>,
    },
    AuthBrowserOpen {
        provider_id: String,
        url: String,
        instructions: Option<String>,
    },
    AuthManualInputRequested {
        provider_id: String,
        request_id: String,
        title: String,
        message: String,
        placeholder: Option<String>,
        kind: String,
    },
    AuthCompleted {
        provider_id: String,
    },
    AuthFailed {
        provider_id: String,
        message: String,
    },
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn default_provider_id() -> String {
    "openai-codex".to_string()
}

fn default_model_id() -> String {
    "gpt-5.4".to_string()
}

fn default_effort() -> String {
    "high".to_string()
}

fn default_fast_mode() -> bool {
    false
}

fn default_provider_status() -> ProviderStatus {
    ProviderStatus::Unavailable
}

fn default_provider_auth_kind() -> ProviderAuthKind {
    ProviderAuthKind::ApiKey
}

fn default_provider_source() -> String {
    "built-in".to_string()
}

pub fn default_providers() -> Vec<ProviderOption> {
    vec![
        ProviderOption {
            id: "openai-codex".to_string(),
            label: "Codex".to_string(),
            status: ProviderStatus::RequiresOauth,
            auth_kind: ProviderAuthKind::Oauth,
            available: false,
            reason: Some("Codex login is required.".to_string()),
            models: vec![
                ModelOption {
                    id: default_model_id(),
                    label: "GPT-5.4".to_string(),
                    provider_id: "openai-codex".to_string(),
                    context_window: "256k".to_string(),
                    available: false,
                    provider_source: default_provider_source(),
                },
                ModelOption {
                    id: "gpt-5.4-mini".to_string(),
                    label: "GPT-5.4 Mini".to_string(),
                    provider_id: "openai-codex".to_string(),
                    context_window: "128k".to_string(),
                    available: false,
                    provider_source: default_provider_source(),
                },
            ],
        },
        ProviderOption {
            id: "anthropic".to_string(),
            label: "Claude".to_string(),
            status: ProviderStatus::RequiresOauth,
            auth_kind: ProviderAuthKind::Oauth,
            available: false,
            reason: Some("Claude login is required.".to_string()),
            models: vec![ModelOption {
                id: "claude-opus-4-6".to_string(),
                label: "Claude Opus 4.6".to_string(),
                provider_id: "anthropic".to_string(),
                context_window: "200k".to_string(),
                available: false,
                provider_source: default_provider_source(),
            }],
        },
        ProviderOption {
            id: "opencode".to_string(),
            label: "OpenCode".to_string(),
            status: ProviderStatus::RequiresApiKey,
            auth_kind: ProviderAuthKind::ApiKey,
            available: false,
            reason: Some("OpenCode API key is required.".to_string()),
            models: vec![ModelOption {
                id: "claude-opus-4-6".to_string(),
                label: "Claude Opus 4.6".to_string(),
                provider_id: "opencode".to_string(),
                context_window: "200k".to_string(),
                available: false,
                provider_source: default_provider_source(),
            }],
        },
        ProviderOption {
            id: "opencode-go".to_string(),
            label: "OpenCode Go".to_string(),
            status: ProviderStatus::RequiresApiKey,
            auth_kind: ProviderAuthKind::ApiKey,
            available: false,
            reason: Some("OpenCode API key is required.".to_string()),
            models: vec![ModelOption {
                id: "kimi-k2.5".to_string(),
                label: "Kimi K2.5".to_string(),
                provider_id: "opencode-go".to_string(),
                context_window: "128k".to_string(),
                available: false,
                provider_source: default_provider_source(),
            }],
        },
        ProviderOption {
            id: "ollama".to_string(),
            label: "Ollama".to_string(),
            status: ProviderStatus::RequiresLocalRuntime,
            auth_kind: ProviderAuthKind::Local,
            available: false,
            reason: Some("Start Ollama locally to enable this provider.".to_string()),
            models: vec![],
        },
    ]
}

pub fn default_preferences() -> AppPreferences {
    AppPreferences {
        theme: "dark".to_string(),
        provider_id: default_provider_id(),
        model_id: default_model_id(),
        approval_mode: ApprovalMode::Supervised,
        effort: default_effort(),
        fast_mode: default_fast_mode(),
        layout: LayoutPreferences {
            diff_mode: "split".to_string(),
            git_panel_open: true,
            diff_panel_open: true,
        },
    }
}

pub fn new_session(title: impl Into<String>) -> ChatSession {
    let now = now_iso();
    ChatSession {
        id: Uuid::new_v4().to_string(),
        title: title.into(),
        branch_label: Some("main".to_string()),
        created_at: now.clone(),
        updated_at: now.clone(),
        status: SessionStatus::Idle,
        runtime: SessionRuntimeMetadata::default(),
        timeline: vec![TimelineItem::SystemNotice {
            id: Uuid::new_v4().to_string(),
            created_at: now,
            title: "Session ready".to_string(),
            detail: "Pi will stream tool activity, approvals, and model output here.".to_string(),
        }],
    }
}

pub fn new_workspace(
    name: impl Into<String>,
    path: impl Into<String>,
    recent_rank: i64,
) -> WorkspaceRecord {
    WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        name: name.into(),
        path: path.into(),
        pinned: recent_rank == 1,
        recent_rank,
        approval_mode: ApprovalMode::Supervised,
        policy: ApprovalPolicy {
            allowed_paths: vec![],
            allowed_commands: vec!["git status".to_string(), "git diff".to_string()],
            env_passthrough: vec!["PATH".to_string(), "HOME".to_string()],
            network_enabled: false,
        },
        provider_id: default_provider_id(),
        model_id: default_model_id(),
        effort: default_effort(),
        fast_mode: default_fast_mode(),
        sessions: vec![new_session("Kickoff")],
    }
}

fn normalize_effort(effort: &mut String) {
    if effort.trim().is_empty() {
        *effort = default_effort();
    }
}

fn migrate_legacy_model_id(model_id: &str) -> Option<&'static str> {
    match model_id {
        "pi-4-pro" | "pi-cloud-max" => Some("gpt-5.4"),
        "pi-4-fast" | "pi-cloud-lite" => Some("gpt-5.4-mini"),
        _ => None,
    }
}

fn normalize_model_selection(
    provider_id: &mut String,
    model_id: &mut String,
    providers: &[ProviderOption],
) {
    let mapped_model_id = migrate_legacy_model_id(model_id.as_str()).unwrap_or(model_id.as_str());
    let selected_provider = providers
        .iter()
        .find(|provider| {
            provider
                .models
                .iter()
                .any(|model| model.id == mapped_model_id)
        })
        .or_else(|| {
            providers
                .iter()
                .find(|provider| provider.id == provider_id.as_str())
        })
        .or_else(|| providers.first());

    let Some(provider) = selected_provider else {
        *provider_id = default_provider_id();
        *model_id = default_model_id();
        return;
    };

    *provider_id = provider.id.clone();
    if provider
        .models
        .iter()
        .any(|model| model.id == mapped_model_id)
    {
        *model_id = mapped_model_id.to_string();
    } else {
        *model_id = provider
            .models
            .first()
            .map(|model| model.id.clone())
            .unwrap_or_else(default_model_id);
    }
}

pub fn normalize_state(mut state: PersistedAppState) -> PersistedAppState {
    state.schema_version = SCHEMA_VERSION;
    state.providers = default_providers();

    normalize_effort(&mut state.preferences.effort);
    normalize_model_selection(
        &mut state.preferences.provider_id,
        &mut state.preferences.model_id,
        &state.providers,
    );

    for workspace in &mut state.workspaces {
        normalize_effort(&mut workspace.effort);
        normalize_model_selection(
            &mut workspace.provider_id,
            &mut workspace.model_id,
            &state.providers,
        );
    }

    state
}

pub fn default_state(
    default_workspace_path: String,
    default_workspace_name: String,
) -> PersistedAppState {
    let workspace = new_workspace(default_workspace_name, default_workspace_path, 1);
    PersistedAppState {
        schema_version: SCHEMA_VERSION,
        active_workspace_id: Some(workspace.id.clone()),
        active_session_id: workspace.sessions.first().map(|session| session.id.clone()),
        workspaces: vec![workspace],
        preferences: default_preferences(),
        providers: default_providers(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_state_defaults_missing_runtime_fields() {
        let parsed: PersistedAppState = serde_json::from_value(json!({
            "schemaVersion": 1,
            "activeWorkspaceId": "workspace-1",
            "activeSessionId": null,
            "workspaces": [{
                "id": "workspace-1",
                "name": "Workspace",
                "path": "/tmp/workspace",
                "pinned": true,
                "recentRank": 1,
                "approvalMode": "ask-first",
                "policy": {
                    "allowedPaths": [],
                    "allowedCommands": [],
                    "envPassthrough": [],
                    "networkEnabled": false
                },
                "providerId": "pi-core",
                "modelId": "pi-4-pro",
                "sessions": []
            }],
            "preferences": {
                "theme": "dark",
                "providerId": "pi-core",
                "modelId": "pi-4-pro",
                "approvalMode": "ask-first",
                "layout": {
                    "diffMode": "split",
                    "gitPanelOpen": true,
                    "diffPanelOpen": true
                }
            },
            "providers": [{
                "id": "pi-core",
                "label": "Pi Core",
                "models": [{
                    "id": "pi-4-pro",
                    "label": "Pi 4 Pro",
                    "providerId": "pi-core",
                    "contextWindow": "256k"
                }]
            }]
        }))
        .expect("legacy state should deserialize");

        assert_eq!(parsed.preferences.effort, "high");
        assert!(!parsed.preferences.fast_mode);
        assert_eq!(parsed.workspaces[0].effort, "high");
        assert!(!parsed.workspaces[0].fast_mode);
    }

    #[test]
    fn normalize_state_migrates_legacy_models() {
        let parsed: PersistedAppState = serde_json::from_value(json!({
            "schemaVersion": 1,
            "activeWorkspaceId": "workspace-1",
            "activeSessionId": null,
            "workspaces": [{
                "id": "workspace-1",
                "name": "Workspace",
                "path": "/tmp/workspace",
                "pinned": true,
                "recentRank": 1,
                "approvalMode": "ask-first",
                "policy": {
                    "allowedPaths": [],
                    "allowedCommands": [],
                    "envPassthrough": [],
                    "networkEnabled": false
                },
                "providerId": "pi-cloud",
                "modelId": "pi-cloud-lite",
                "sessions": []
            }],
            "preferences": {
                "theme": "dark",
                "providerId": "pi-core",
                "modelId": "pi-4-pro",
                "approvalMode": "ask-first",
                "layout": {
                    "diffMode": "split",
                    "gitPanelOpen": true,
                    "diffPanelOpen": true
                }
            },
            "providers": [{
                "id": "pi-cloud",
                "label": "Pi Cloud",
                "models": [{
                    "id": "pi-cloud-lite",
                    "label": "Pi Cloud Lite",
                    "providerId": "pi-cloud",
                    "contextWindow": "128k"
                }]
            }]
        }))
        .expect("legacy state should deserialize");

        let normalized = normalize_state(parsed);

        assert_eq!(normalized.preferences.provider_id, "openai-codex");
        assert_eq!(normalized.preferences.model_id, "gpt-5.4");
        assert_eq!(normalized.workspaces[0].provider_id, "openai-codex");
        assert_eq!(normalized.workspaces[0].model_id, "gpt-5.4-mini");
        assert_eq!(normalized.providers[0].id, "openai-codex");
        assert_eq!(normalized.providers[0].models[0].id, "gpt-5.4");
    }
}
