use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{env, path::PathBuf};
use uuid::Uuid;

pub const SCHEMA_VERSION: u32 = 6;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalMode {
    #[serde(alias = "ask-first")]
    Supervised,
    AutoAcceptEdits,
    FullAccess,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PromptMode {
    Plan,
    Build,
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
    pub reasoning: bool,
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
#[serde(rename_all = "camelCase")]
pub struct MessageImageAttachment {
    pub mime_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum TimelineItem {
    UserMessage {
        id: String,
        created_at: String,
        content: String,
        #[serde(default)]
        images: Vec<MessageImageAttachment>,
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
    pub archived_at: Option<String>,
    #[serde(default)]
    pub selection: SessionModelSelection,
    #[serde(default)]
    pub runtime: SessionRuntimeMetadata,
    pub timeline: Vec<TimelineItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModelSelection {
    #[serde(default = "default_provider_id")]
    pub provider_id: String,
    #[serde(default = "default_model_id")]
    pub model_id: String,
    #[serde(default = "default_effort")]
    pub effort: String,
    #[serde(default = "default_fast_mode")]
    pub fast_mode: bool,
}

impl Default for SessionModelSelection {
    fn default() -> Self {
        Self {
            provider_id: String::new(),
            model_id: String::new(),
            effort: String::new(),
            fast_mode: default_fast_mode(),
        }
    }
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
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    #[serde(default)]
    pub tokens: Option<u64>,
    pub context_window: u64,
    #[serde(default)]
    pub percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    #[serde(default)]
    pub session_file: Option<String>,
    pub session_id: String,
    pub user_messages: u64,
    pub assistant_messages: u64,
    pub tool_calls: u64,
    pub tool_results: u64,
    pub total_messages: u64,
    pub tokens: TokenUsage,
    pub cost: f64,
    #[serde(default)]
    pub context_usage: Option<ContextUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub total: u64,
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
    #[serde(default = "default_model_selection_scope")]
    pub model_selection_scope: String,
    #[serde(default = "default_thread_model_memory")]
    pub thread_model_memory: String,
    #[serde(default = "default_provider_id")]
    pub provider_id: String,
    #[serde(default = "default_model_id")]
    pub model_id: String,
    #[serde(default = "default_provider_id")]
    pub title_model_provider_id: String,
    #[serde(default = "default_model_id")]
    pub title_model_id: String,
    #[serde(default = "default_provider_id")]
    pub title_model_fallback_provider_id: String,
    #[serde(default = "default_model_id")]
    pub title_model_fallback_id: String,
    #[serde(default = "default_effort")]
    pub title_model_effort: String,
    #[serde(default = "default_auto_title_enabled")]
    pub auto_title_enabled: bool,
    #[serde(default = "default_auto_git_messages_enabled")]
    pub auto_git_messages_enabled: bool,
    #[serde(default = "default_provider_id")]
    pub git_message_model_provider_id: String,
    #[serde(default = "default_title_model_id")]
    pub git_message_model_id: String,
    #[serde(default = "default_provider_id")]
    pub git_message_model_fallback_provider_id: String,
    #[serde(default = "default_model_id")]
    pub git_message_model_fallback_id: String,
    #[serde(default = "default_effort")]
    pub git_message_model_effort: String,
    #[serde(default = "default_show_raw_tool_calls")]
    pub show_raw_tool_calls: bool,
    pub approval_mode: ApprovalMode,
    #[serde(default = "default_effort")]
    pub effort: String,
    #[serde(default = "default_fast_mode")]
    pub fast_mode: bool,
    #[serde(default)]
    pub pi_binary_path: Option<String>,
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
    #[serde(default)]
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
pub struct AppPaths {
    pub app_data_dir: String,
    pub keybindings_path: String,
    pub logs_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBootstrapPayload {
    pub install: PiInstallStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealthPayload {
    pub install: PiInstallStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PiInstallState {
    Ready,
    Missing,
    Broken,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiInstallStatus {
    pub status: PiInstallState,
    #[serde(default)]
    pub binary_path: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    pub install_url: String,
    pub install_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshWorkspaceRuntimeCatalogPayload {
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRuntimeCatalogPayload {
    pub workspace_id: String,
    pub providers: Vec<ProviderOption>,
    pub selected_provider_id: String,
    pub selected_model_id: String,
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
    #[serde(default)]
    pub session_id: Option<String>,
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
    pub user_message_id: String,
    pub prompt: String,
    pub mode: PromptMode,
    #[serde(default)]
    pub selection: Option<SessionModelSelection>,
    #[serde(default)]
    pub images: Vec<MessageImageAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoUserTurnPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub user_message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdentityPayload {
    pub workspace_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderWorkspacePayload {
    pub workspace_id: String,
    #[serde(default)]
    pub before_workspace_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderSessionPayload {
    pub workspace_id: String,
    pub session_id: String,
    #[serde(default)]
    pub before_session_id: Option<String>,
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
pub struct ArchiveSessionPayload {
    pub workspace_id: String,
    pub session_id: String,
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
pub struct AbortPromptPayload {
    pub workspace_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureTerminalSessionPayload {
    pub workspace_id: String,
    pub terminal_tab_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTerminalInputPayload {
    pub workspace_id: String,
    pub terminal_tab_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeTerminalPayload {
    pub workspace_id: String,
    pub terminal_tab_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTerminalCommandPayload {
    pub workspace_id: String,
    pub terminal_tab_id: String,
    pub command: String,
    #[serde(default)]
    pub refresh_git: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTerminalSessionPayload {
    pub workspace_id: String,
    pub terminal_tab_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextFilePayload {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTerminalCommandResult {
    pub terminal_tab_id: String,
    pub command_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GitAction {
    Commit,
    CommitPush,
    Push,
    CreatePr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareGitActionPayload {
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedGitAction {
    pub branch: String,
    pub file_count: usize,
    pub additions: usize,
    pub deletions: usize,
    pub staged_count: usize,
    pub unstaged_count: usize,
    pub has_staged: bool,
    pub has_unstaged: bool,
    pub can_push: bool,
    pub can_create_pr: bool,
    pub pr_unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunGitActionPayload {
    pub workspace_id: String,
    pub action: GitAction,
    pub include_unstaged: bool,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub custom_instructions: Option<String>,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunGitActionResult {
    pub summary: String,
    pub generated_message: Option<String>,
    pub pr_url: Option<String>,
    pub git: GitSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveExtensionUiRequestPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub request_id: String,
    pub response: serde_json::Value,
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
    SessionTitled {
        workspace_id: String,
        session_id: String,
        title: String,
    },
    ExtensionUiRequest {
        workspace_id: String,
        session_id: String,
        request: serde_json::Value,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TerminalEvent {
    Started {
        workspace_id: String,
        terminal_tab_id: String,
    },
    Output {
        workspace_id: String,
        terminal_tab_id: String,
        chunk: String,
    },
    CommandFinished {
        workspace_id: String,
        terminal_tab_id: String,
        command_id: String,
        command: String,
        exit_code: i32,
        git_snapshot: Option<GitSnapshot>,
    },
    Error {
        workspace_id: String,
        terminal_tab_id: String,
        message: String,
    },
    Exit {
        workspace_id: String,
        terminal_tab_id: String,
        exit_code: Option<i32>,
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

fn default_title_model_id() -> String {
    "gpt-5.4-mini".to_string()
}

fn default_effort() -> String {
    "high".to_string()
}

fn default_fast_mode() -> bool {
    false
}

fn default_auto_title_enabled() -> bool {
    true
}

fn default_auto_git_messages_enabled() -> bool {
    true
}

fn default_show_raw_tool_calls() -> bool {
    false
}

fn default_model_selection_scope() -> String {
    "thread".to_string()
}

fn default_thread_model_memory() -> String {
    "selected".to_string()
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
                    reasoning: true,
                    available: false,
                    provider_source: default_provider_source(),
                },
                ModelOption {
                    id: "gpt-5.4-mini".to_string(),
                    label: "GPT-5.4 Mini".to_string(),
                    provider_id: "openai-codex".to_string(),
                    context_window: "128k".to_string(),
                    reasoning: true,
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
                reasoning: true,
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
                reasoning: true,
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
                reasoning: true,
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
        model_selection_scope: default_model_selection_scope(),
        thread_model_memory: default_thread_model_memory(),
        provider_id: default_provider_id(),
        model_id: default_model_id(),
        title_model_provider_id: default_provider_id(),
        title_model_id: default_title_model_id(),
        title_model_fallback_provider_id: default_provider_id(),
        title_model_fallback_id: default_model_id(),
        title_model_effort: default_effort(),
        auto_title_enabled: default_auto_title_enabled(),
        auto_git_messages_enabled: default_auto_git_messages_enabled(),
        git_message_model_provider_id: default_provider_id(),
        git_message_model_id: default_title_model_id(),
        git_message_model_fallback_provider_id: default_provider_id(),
        git_message_model_fallback_id: default_model_id(),
        git_message_model_effort: default_effort(),
        show_raw_tool_calls: default_show_raw_tool_calls(),
        approval_mode: ApprovalMode::Supervised,
        effort: default_effort(),
        fast_mode: default_fast_mode(),
        pi_binary_path: None,
        layout: LayoutPreferences {
            diff_mode: "split".to_string(),
            git_panel_open: true,
            diff_panel_open: true,
        },
    }
}

pub fn expand_user_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let Some(home) = env::var_os("HOME") else {
        return trimmed.to_string();
    };

    if trimmed == "~" {
        return PathBuf::from(home).to_string_lossy().into_owned();
    }

    if let Some(suffix) = trimmed.strip_prefix("~/") {
        return PathBuf::from(home)
            .join(suffix)
            .to_string_lossy()
            .into_owned();
    }

    trimmed.to_string()
}

pub fn new_session(title: impl Into<String>, selection: SessionModelSelection) -> ChatSession {
    let now = now_iso();
    ChatSession {
        id: Uuid::new_v4().to_string(),
        title: title.into(),
        branch_label: Some("main".to_string()),
        created_at: now.clone(),
        updated_at: now.clone(),
        status: SessionStatus::Idle,
        archived_at: None,
        selection,
        runtime: SessionRuntimeMetadata::default(),
        timeline: vec![TimelineItem::SystemNotice {
            id: Uuid::new_v4().to_string(),
            created_at: now,
            title: "Session ready".to_string(),
            detail: "The selected model will stream tool activity, approvals, and output here."
                .to_string(),
        }],
    }
}

pub fn new_workspace(
    name: impl Into<String>,
    path: impl Into<String>,
    recent_rank: i64,
) -> WorkspaceRecord {
    let path = expand_user_path(&path.into());
    WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        name: name.into(),
        path,
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
        sessions: vec![new_session(
            "New thread",
            SessionModelSelection {
                provider_id: default_provider_id(),
                model_id: default_model_id(),
                effort: default_effort(),
                fast_mode: default_fast_mode(),
            },
        )],
    }
}

fn normalize_effort(effort: &mut String) {
    if effort.trim().is_empty() {
        *effort = default_effort();
    }
}

fn normalize_workspace_path(path: &mut String) {
    *path = expand_user_path(path);
}

fn migrate_legacy_model_id(model_id: &str) -> Option<&'static str> {
    match model_id {
        "pi-4-pro" | "pi-cloud-max" => Some("gpt-5.4"),
        "pi-4-fast" | "pi-cloud-lite" => Some("gpt-5.4-mini"),
        "gpt-5.1-codex-max" => Some("gpt-5.4"),
        "gpt-5.1-codex-mini" => Some("gpt-5.4-mini"),
        _ => None,
    }
}

fn normalize_stored_model_selection(provider_id: &mut String, model_id: &mut String) {
    let mapped_model_id = migrate_legacy_model_id(model_id.as_str()).unwrap_or(model_id.as_str());

    if provider_id.trim().is_empty() {
        *provider_id = default_provider_id();
    }
    if mapped_model_id.trim().is_empty() {
        *model_id = default_model_id();
    } else {
        *model_id = mapped_model_id.to_string();
    }
}

fn normalize_session_selection(selection: &mut SessionModelSelection) {
    normalize_effort(&mut selection.effort);
    normalize_stored_model_selection(&mut selection.provider_id, &mut selection.model_id);
}

pub fn normalize_state(mut state: PersistedAppState) -> PersistedAppState {
    state.schema_version = SCHEMA_VERSION;
    if state.providers.is_empty() {
        state.providers = default_providers();
    }

    normalize_effort(&mut state.preferences.effort);
    normalize_stored_model_selection(
        &mut state.preferences.provider_id,
        &mut state.preferences.model_id,
    );
    normalize_stored_model_selection(
        &mut state.preferences.title_model_provider_id,
        &mut state.preferences.title_model_id,
    );
    normalize_stored_model_selection(
        &mut state.preferences.title_model_fallback_provider_id,
        &mut state.preferences.title_model_fallback_id,
    );
    normalize_effort(&mut state.preferences.title_model_effort);
    normalize_stored_model_selection(
        &mut state.preferences.git_message_model_provider_id,
        &mut state.preferences.git_message_model_id,
    );
    normalize_stored_model_selection(
        &mut state.preferences.git_message_model_fallback_provider_id,
        &mut state.preferences.git_message_model_fallback_id,
    );
    normalize_effort(&mut state.preferences.git_message_model_effort);

    for workspace in &mut state.workspaces {
        normalize_workspace_path(&mut workspace.path);
        normalize_effort(&mut workspace.effort);
        normalize_stored_model_selection(&mut workspace.provider_id, &mut workspace.model_id);

        if workspace.sessions.is_empty() {
            workspace.sessions.push(new_session(
                "New thread",
                SessionModelSelection {
                    provider_id: workspace.provider_id.clone(),
                    model_id: workspace.model_id.clone(),
                    effort: workspace.effort.clone(),
                    fast_mode: workspace.fast_mode,
                },
            ));
        }

        for session in &mut workspace.sessions {
            if session.title.trim().eq_ignore_ascii_case("kickoff") {
                session.title = "New thread".to_string();
            }

            if session.selection.provider_id.trim().is_empty()
                && session.selection.model_id.trim().is_empty()
            {
                session.selection = SessionModelSelection {
                    provider_id: workspace.provider_id.clone(),
                    model_id: workspace.model_id.clone(),
                    effort: workspace.effort.clone(),
                    fast_mode: workspace.fast_mode,
                };
            }

            normalize_session_selection(&mut session.selection);
        }
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
            "schemaVersion": 2,
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
        assert_eq!(parsed.preferences.pi_binary_path, None);
        assert!(!parsed.preferences.show_raw_tool_calls);
        assert!(parsed.preferences.auto_git_messages_enabled);
        assert_eq!(
            parsed.preferences.git_message_model_provider_id,
            "openai-codex"
        );
        assert_eq!(parsed.preferences.git_message_model_id, "gpt-5.4-mini");
        assert_eq!(parsed.preferences.git_message_model_fallback_id, "gpt-5.4");
        assert_eq!(parsed.preferences.git_message_model_effort, "high");
        assert_eq!(parsed.workspaces[0].effort, "high");
        assert!(!parsed.workspaces[0].fast_mode);
    }

    #[test]
    fn normalize_state_migrates_v2_state_to_v3_without_overwriting_legacy_providers() {
        let parsed: PersistedAppState = serde_json::from_value(json!({
            "schemaVersion": 2,
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

        assert_eq!(normalized.schema_version, 6);
        assert_eq!(normalized.preferences.provider_id, "pi-core");
        assert_eq!(normalized.preferences.model_id, "gpt-5.4");
        assert!(!normalized.preferences.show_raw_tool_calls);
        assert_eq!(normalized.workspaces[0].provider_id, "pi-cloud");
        assert_eq!(normalized.workspaces[0].model_id, "gpt-5.4-mini");
        assert_eq!(
            normalized.workspaces[0].sessions[0].selection.provider_id,
            "pi-cloud"
        );
        assert_eq!(normalized.providers[0].id, "pi-cloud");
        assert_eq!(normalized.providers[0].models[0].id, "pi-cloud-lite");
    }

    #[test]
    fn legacy_approval_fields_still_deserialize() {
        let parsed: PersistedAppState = serde_json::from_value(json!({
            "schemaVersion": 2,
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
                    "allowedPaths": ["/tmp/workspace"],
                    "allowedCommands": ["git status"],
                    "envPassthrough": ["PATH"],
                    "networkEnabled": false
                },
                "providerId": "openai-codex",
                "modelId": "gpt-5.4",
                "sessions": []
            }],
            "preferences": {
                "theme": "dark",
                "providerId": "openai-codex",
                "modelId": "gpt-5.4",
                "approvalMode": "full-access",
                "layout": {
                    "diffMode": "split",
                    "gitPanelOpen": true,
                    "diffPanelOpen": true
                }
            }
        }))
        .expect("legacy state should deserialize");

        assert!(matches!(
            parsed.workspaces[0].approval_mode,
            ApprovalMode::Supervised
        ));
        assert!(matches!(
            parsed.preferences.approval_mode,
            ApprovalMode::FullAccess
        ));
        assert_eq!(
            parsed.workspaces[0].policy.allowed_commands,
            vec!["git status".to_string()]
        );
    }

    #[test]
    fn default_preferences_leave_pi_binary_path_unset() {
        let preferences = default_preferences();
        assert_eq!(preferences.pi_binary_path, None);
        assert_eq!(preferences.title_model_id, "gpt-5.4-mini");
        assert_eq!(preferences.title_model_fallback_provider_id, "openai-codex");
        assert_eq!(preferences.title_model_fallback_id, "gpt-5.4");
        assert_eq!(preferences.title_model_effort, "high");
        assert!(preferences.auto_git_messages_enabled);
        assert_eq!(preferences.git_message_model_provider_id, "openai-codex");
        assert_eq!(preferences.git_message_model_id, "gpt-5.4-mini");
        assert_eq!(
            preferences.git_message_model_fallback_provider_id,
            "openai-codex"
        );
        assert_eq!(preferences.git_message_model_fallback_id, "gpt-5.4");
        assert_eq!(preferences.git_message_model_effort, "high");
        assert!(!preferences.show_raw_tool_calls);
    }

    #[test]
    fn normalize_state_migrates_stale_codex_model_ids() {
        let parsed: PersistedAppState = serde_json::from_value(json!({
            "schemaVersion": 3,
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
                "providerId": "openai-codex",
                "modelId": "gpt-5.1-codex-mini",
                "sessions": []
            }],
            "preferences": {
                "theme": "dark",
                "providerId": "openai-codex",
                "modelId": "gpt-5.1-codex-max",
                "approvalMode": "ask-first",
                "layout": {
                    "diffMode": "split",
                    "gitPanelOpen": true,
                    "diffPanelOpen": true
                }
            }
        }))
        .expect("state should deserialize");

        let normalized = normalize_state(parsed);

        assert_eq!(normalized.preferences.model_id, "gpt-5.4");
        assert_eq!(normalized.workspaces[0].model_id, "gpt-5.4-mini");
        assert_eq!(normalized.workspaces[0].sessions[0].title, "New thread");
    }

    #[test]
    fn normalize_state_expands_home_prefixed_workspace_paths() {
        let parsed: PersistedAppState = serde_json::from_value(json!({
            "schemaVersion": 3,
            "activeWorkspaceId": "workspace-1",
            "activeSessionId": null,
            "workspaces": [{
                "id": "workspace-1",
                "name": "Workspace",
                "path": "~/tmp/workspace",
                "pinned": true,
                "recentRank": 1,
                "approvalMode": "ask-first",
                "policy": {
                    "allowedPaths": [],
                    "allowedCommands": [],
                    "envPassthrough": [],
                    "networkEnabled": false
                },
                "providerId": "openai-codex",
                "modelId": "gpt-5.4",
                "sessions": []
            }],
            "preferences": {
                "theme": "dark",
                "providerId": "openai-codex",
                "modelId": "gpt-5.4",
                "approvalMode": "ask-first",
                "layout": {
                    "diffMode": "split",
                    "gitPanelOpen": true,
                    "diffPanelOpen": true
                }
            }
        }))
        .expect("state should deserialize");

        let normalized = normalize_state(parsed);
        let expected_prefix = env::var("HOME").expect("HOME should be set in tests");

        assert!(normalized.workspaces[0].path.starts_with(&expected_prefix));
        assert!(normalized.workspaces[0].path.ends_with("/tmp/workspace"));
    }
}
