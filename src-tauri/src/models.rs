use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalMode {
    AskFirst,
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
    pub models: Vec<ModelOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub label: String,
    pub provider_id: String,
    pub context_window: String,
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
    pub timeline: Vec<TimelineItem>,
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
    pub provider_id: String,
    pub model_id: String,
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
    pub provider_id: String,
    pub model_id: String,
    pub approval_mode: ApprovalMode,
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
pub struct RefreshGitPayload {
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum PiRuntimeEvent {
    Token {
        workspace_id: String,
        session_id: String,
        delta: String,
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
        workspace_id: String,
        session_id: String,
        label: String,
        detail: Option<String>,
    },
    Error {
        workspace_id: String,
        session_id: String,
        message: String,
    },
    Done {
        workspace_id: String,
        session_id: String,
        content: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarLineEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub delta: Option<String>,
    pub label: Option<String>,
    pub detail: Option<String>,
    pub activity: Option<ToolActivity>,
    pub activity_id: Option<String>,
    pub output: Option<String>,
    pub status: Option<ToolStatus>,
    pub approval: Option<ApprovalRequest>,
    pub content: Option<String>,
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub fn default_providers() -> Vec<ProviderOption> {
    vec![
        ProviderOption {
            id: "pi-core".to_string(),
            label: "Pi Core".to_string(),
            models: vec![
                ModelOption {
                    id: "pi-4-pro".to_string(),
                    label: "Pi 4 Pro".to_string(),
                    provider_id: "pi-core".to_string(),
                    context_window: "256k".to_string(),
                },
                ModelOption {
                    id: "pi-4-fast".to_string(),
                    label: "Pi 4 Fast".to_string(),
                    provider_id: "pi-core".to_string(),
                    context_window: "128k".to_string(),
                },
            ],
        },
        ProviderOption {
            id: "pi-cloud".to_string(),
            label: "Pi Cloud".to_string(),
            models: vec![
                ModelOption {
                    id: "pi-cloud-max".to_string(),
                    label: "Pi Cloud Max".to_string(),
                    provider_id: "pi-cloud".to_string(),
                    context_window: "512k".to_string(),
                },
                ModelOption {
                    id: "pi-cloud-lite".to_string(),
                    label: "Pi Cloud Lite".to_string(),
                    provider_id: "pi-cloud".to_string(),
                    context_window: "128k".to_string(),
                },
            ],
        },
    ]
}

pub fn default_preferences() -> AppPreferences {
    AppPreferences {
        theme: "dark".to_string(),
        provider_id: "pi-core".to_string(),
        model_id: "pi-4-pro".to_string(),
        approval_mode: ApprovalMode::AskFirst,
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
        approval_mode: ApprovalMode::AskFirst,
        policy: ApprovalPolicy {
            allowed_paths: vec![],
            allowed_commands: vec!["git status".to_string(), "git diff".to_string()],
            env_passthrough: vec!["PATH".to_string(), "HOME".to_string()],
            network_enabled: false,
        },
        provider_id: "pi-core".to_string(),
        model_id: "pi-4-pro".to_string(),
        sessions: vec![new_session("Kickoff")],
    }
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
