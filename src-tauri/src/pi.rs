use crate::models::{
    AbortPromptPayload, ApprovalDecision, ApprovalState, ModelOption, PiInstallState,
    PiInstallStatus, PiRuntimeEvent, PromptMode, ProviderAuthKind, ProviderOption, ProviderStatus,
    RefreshWorkspaceRuntimeCatalogPayload, ResolveApprovalPayload, RuntimeBootstrapPayload,
    RuntimeHealthPayload, SendPromptPayload, SessionModelSelection, SessionRuntimeMetadata,
    SessionStatus, TimelineItem, ToolActivity, ToolStatus, WorkspaceRuntimeCatalogPayload,
    expand_user_path, now_iso,
};
use crate::{AppState, git, storage};
use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    env,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command},
    sync::{Mutex, oneshot},
    time::timeout,
};
use uuid::Uuid;

const PI_INSTALL_URL: &str =
    "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md";
const PI_INSTALL_COMMAND: &str = "npm install -g @mariozechner/pi-coding-agent";
const RPC_PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const SESSION_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Default)]
pub struct PiRuntimeHandle {
    sessions: Arc<Mutex<HashMap<String, ActiveSessionHandle>>>,
}

#[derive(Clone)]
struct ActiveSessionHandle {
    inner: Arc<ActiveSessionInner>,
}

struct ActiveSessionInner {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    counter: AtomicU64,
    abort_requested: AtomicBool,
}

impl ActiveSessionHandle {
    fn new(child: Child, stdin: ChildStdin) -> Self {
        Self {
            inner: Arc::new(ActiveSessionInner {
                child: Mutex::new(child),
                stdin: Mutex::new(stdin),
                pending: Mutex::new(HashMap::new()),
                counter: AtomicU64::new(1),
                abort_requested: AtomicBool::new(false),
            }),
        }
    }

    fn next_request_id(&self) -> String {
        format!(
            "session-{}",
            self.inner.counter.fetch_add(1, Ordering::Relaxed)
        )
    }

    async fn fail_pending(&self, message: &str) {
        let mut pending = self.inner.pending.lock().await;
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(message.to_string()));
        }
    }

    async fn request<P, R>(&self, payload: &P) -> Result<R>
    where
        P: Serialize + ?Sized,
        R: DeserializeOwned,
    {
        let request_id = self.next_request_id();
        let (tx, rx) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .await
            .insert(request_id.clone(), tx);

        let line = serde_json::to_string(&RpcRequestEnvelope {
            id: request_id.clone(),
            payload,
        })?;

        {
            let mut stdin = self.inner.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await?;
            stdin.write_all(b"\n").await?;
            stdin.flush().await?;
        }

        let response = timeout(SESSION_REQUEST_TIMEOUT, rx)
            .await
            .context("timed out waiting for Pi RPC response")?
            .context("Pi RPC response channel dropped")?
            .map_err(|error| anyhow!(error))?;
        Ok(serde_json::from_value(response)?)
    }

    async fn terminate(&self) {
        let mut child = self.inner.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    fn mark_abort_requested(&self) {
        self.inner.abort_requested.store(true, Ordering::Relaxed);
    }

    fn abort_requested(&self) -> bool {
        self.inner.abort_requested.load(Ordering::Relaxed)
    }
}

impl PiRuntimeHandle {
    async fn insert_session(&self, key: String, handle: ActiveSessionHandle) -> Result<()> {
        let mut sessions = self.sessions.lock().await;
        if sessions.contains_key(&key) {
            return Err(anyhow!("A Pi prompt is already active for this session."));
        }
        sessions.insert(key, handle);
        Ok(())
    }

    async fn remove_session(&self, key: &str) -> Option<ActiveSessionHandle> {
        self.sessions.lock().await.remove(key)
    }

    async fn get_session(&self, key: &str) -> Option<ActiveSessionHandle> {
        self.sessions.lock().await.get(key).cloned()
    }
}

#[derive(Serialize)]
struct RpcRequestEnvelope<'a, P: ?Sized> {
    id: String,
    #[serde(flatten)]
    payload: &'a P,
}

#[derive(Debug, Deserialize)]
struct RpcResponseEnvelope {
    #[serde(default)]
    id: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    _command: Option<String>,
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct PiModel {
    id: String,
    name: String,
    provider: String,
    #[serde(default)]
    reasoning: bool,
    #[serde(rename = "contextWindow")]
    context_window: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct AvailableModelsResponse {
    models: Vec<PiModel>,
}

#[derive(Debug, Clone, Deserialize)]
struct PiMessage {
    role: String,
    content: PiMessageContent,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(rename = "stopReason", default)]
    stop_reason: Option<String>,
    #[serde(rename = "errorMessage", default)]
    error_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum PiMessageContent {
    Text(String),
    Blocks(Vec<PiContentBlock>),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
enum PiContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "toolCall")]
    ToolCall {
        #[serde(rename = "id")]
        _id: String,
        #[serde(rename = "name")]
        _name: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize)]
struct PiToolResult {
    content: Vec<PiToolResultContent>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
enum PiToolResultContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AssistantMessageEvent {
    TextDelta {
        delta: String,
    },
    TextEnd {
        #[serde(rename = "content")]
        _content: String,
    },
    Done {
        reason: String,
    },
    Error {
        reason: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RpcEvent {
    AgentStart,
    TurnStart,
    TurnEnd {
        #[serde(default)]
        _message: Option<PiMessage>,
        #[serde(rename = "toolResults", default)]
        _tool_results: Vec<Value>,
    },
    AgentEnd {
        #[serde(default)]
        messages: Vec<PiMessage>,
    },
    MessageStart {
        #[serde(rename = "message")]
        _message: PiMessage,
    },
    MessageEnd {
        message: PiMessage,
    },
    MessageUpdate {
        #[serde(default)]
        message: Option<PiMessage>,
        #[serde(rename = "assistantMessageEvent")]
        assistant_message_event: AssistantMessageEvent,
    },
    ToolExecutionStart {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        #[serde(default)]
        args: Value,
    },
    ToolExecutionUpdate {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        _tool_name: String,
        #[serde(default)]
        _args: Value,
        #[serde(rename = "partialResult")]
        partial_result: PiToolResult,
    },
    ToolExecutionEnd {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        _tool_name: String,
        result: PiToolResult,
        #[serde(rename = "isError")]
        is_error: bool,
    },
    CompactionStart {
        reason: String,
    },
    CompactionEnd {
        reason: String,
        #[serde(rename = "errorMessage")]
        error_message: Option<String>,
    },
    AutoRetryStart {
        attempt: u32,
        #[serde(rename = "maxAttempts")]
        max_attempts: u32,
        #[serde(rename = "errorMessage")]
        error_message: String,
    },
    AutoRetryEnd {
        success: bool,
        attempt: u32,
        #[serde(rename = "finalError")]
        final_error: Option<String>,
    },
    ExtensionError {
        #[serde(default)]
        error: Option<String>,
        #[serde(default)]
        message: Option<String>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct PiSessionEntry {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    message: Option<PiMessage>,
}

#[derive(Debug, Clone)]
struct ResolvedPiInstall {
    install: PiInstallStatus,
    binary_path: Option<PathBuf>,
}

fn session_key(workspace_id: &str, session_id: &str) -> String {
    format!("{workspace_id}:{session_id}")
}

fn install_status(
    status: PiInstallState,
    binary_path: Option<PathBuf>,
    version: Option<String>,
    error: Option<String>,
) -> PiInstallStatus {
    PiInstallStatus {
        status,
        binary_path: binary_path.map(|path| path.to_string_lossy().into_owned()),
        version,
        error,
        install_url: PI_INSTALL_URL.to_string(),
        install_command: PI_INSTALL_COMMAND.to_string(),
    }
}

fn common_install_locations() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut paths = Vec::new();
        if let Some(user_profile) = env::var_os("USERPROFILE") {
            let profile = PathBuf::from(user_profile);
            paths.push(profile.join(".bun").join("bin").join("pi.exe"));
            paths.push(profile.join(".bun").join("bin").join("pi.cmd"));
        }
        if let Some(app_data) = env::var_os("APPDATA") {
            let app_data = PathBuf::from(app_data);
            paths.push(app_data.join("npm").join("pi.cmd"));
            paths.push(app_data.join("npm").join("pi.exe"));
        }
        paths
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut paths = Vec::new();
        if let Some(home) = env::var_os("HOME") {
            let home = PathBuf::from(home);
            paths.push(home.join(".bun").join("bin").join("pi"));
            paths.push(home.join(".local").join("bin").join("pi"));
            paths.push(home.join(".npm-global").join("bin").join("pi"));
            paths.push(home.join(".volta").join("bin").join("pi"));
            paths.push(home.join(".fnm").join("current").join("bin").join("pi"));
            paths.push(home.join(".nvm").join("current").join("bin").join("pi"));

            let nvm_versions = home.join(".nvm").join("versions").join("node");
            if let Ok(entries) = std::fs::read_dir(nvm_versions) {
                let mut version_dirs = entries
                    .filter_map(|entry| entry.ok().map(|item| item.path()))
                    .filter(|path| path.is_dir())
                    .collect::<Vec<_>>();
                version_dirs.sort();
                version_dirs.reverse();
                for version_dir in version_dirs {
                    paths.push(version_dir.join("bin").join("pi"));
                }
            }
        }
        if let Some(prefix) = env::var_os("npm_config_prefix") {
            paths.push(PathBuf::from(prefix).join("bin").join("pi"));
        }
        paths.push(PathBuf::from("/opt/homebrew/bin/pi"));
        paths.push(PathBuf::from("/usr/local/bin/pi"));
        paths
    }
}

fn command_for_binary(binary_path: &Path) -> Command {
    #[cfg(target_os = "windows")]
    {
        let extension = binary_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        if matches!(extension.as_deref(), Some("cmd") | Some("bat")) {
            let mut command = Command::new("cmd");
            command.arg("/C").arg(binary_path);
            return command;
        }
    }

    Command::new(binary_path)
}

fn candidate_names() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["pi.exe", "pi.cmd", "pi.bat", "pi"]
    }
    #[cfg(not(target_os = "windows"))]
    {
        &["pi"]
    }
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return std::fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }

    #[cfg(not(unix))]
    {
        true
    }
}

fn push_candidate(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
}

fn find_path_candidates() -> Vec<PathBuf> {
    let Some(path_value) = env::var_os("PATH") else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    for directory in env::split_paths(&path_value) {
        for name in candidate_names() {
            let candidate = directory.join(name);
            if is_executable(&candidate) {
                push_candidate(&mut candidates, candidate);
            }
        }
    }
    candidates
}

fn choose_candidate_paths(
    override_path: Option<PathBuf>,
    path_candidates: &[PathBuf],
    common_candidates: &[PathBuf],
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(override_path) = override_path {
        push_candidate(&mut candidates, override_path);
        return candidates;
    }

    for candidate in path_candidates {
        push_candidate(&mut candidates, candidate.clone());
    }
    for candidate in common_candidates {
        push_candidate(&mut candidates, candidate.clone());
    }

    candidates
}

fn select_version_output(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    if !stdout.is_empty() {
        return Some(stdout);
    }

    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    if !stderr.is_empty() {
        return Some(stderr);
    }

    None
}

async fn run_version_command(binary_path: &Path) -> Result<String> {
    let mut command = command_for_binary(binary_path);
    let output = command
        .arg("--version")
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .output()
        .await
        .with_context(|| format!("failed to execute {} --version", binary_path.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(anyhow!(
            "{} --version exited unsuccessfully{}",
            binary_path.display(),
            if stderr.is_empty() {
                String::new()
            } else {
                format!(": {stderr}")
            }
        ));
    }

    let Some(version) = select_version_output(&output.stdout, &output.stderr) else {
        return Err(anyhow!(
            "{} --version returned no output",
            binary_path.display()
        ));
    };
    Ok(version)
}

async fn read_stream_to_string<R>(mut reader: R) -> String
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Vec::new();
    let _ = reader.read_to_end(&mut bytes).await;
    String::from_utf8_lossy(&bytes).trim().to_string()
}

async fn read_response_from_stdout(
    stdout: &mut ChildStdout,
    request_id: &str,
) -> Result<RpcResponseEnvelope> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];

    loop {
        let read = stdout.read(&mut chunk).await?;
        if read == 0 {
            return Err(anyhow!("Pi RPC process ended before responding"));
        }

        buffer.extend_from_slice(&chunk[..read]);

        while let Some(position) = buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = buffer.drain(..=position).collect::<Vec<_>>();
            if matches!(line.last(), Some(&b'\n')) {
                line.pop();
            }
            if matches!(line.last(), Some(&b'\r')) {
                line.pop();
            }
            if line.is_empty() {
                continue;
            }

            let response: RpcResponseEnvelope =
                serde_json::from_slice(&line).with_context(|| {
                    format!(
                        "failed to parse Pi RPC line: {}",
                        String::from_utf8_lossy(&line)
                    )
                })?;
            if response.kind == "response" && response.id.as_deref() == Some(request_id) {
                return Ok(response);
            }
        }
    }
}

async fn run_rpc_once(
    binary_path: &Path,
    cwd: Option<&Path>,
    extra_args: &[&str],
    payload: Value,
) -> Result<Value> {
    let request_id = Uuid::new_v4().to_string();
    let mut command = command_for_binary(binary_path);
    command
        .arg("--mode")
        .arg("rpc")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    for arg in extra_args {
        command.arg(arg);
    }
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }

    let mut child = command.spawn().with_context(|| {
        format!(
            "failed to spawn Pi RPC process at {}",
            binary_path.display()
        )
    })?;

    let mut stdin = child
        .stdin
        .take()
        .context("Pi RPC stdin was not available")?;
    let mut stdout = child
        .stdout
        .take()
        .context("Pi RPC stdout was not available")?;
    let stderr = child
        .stderr
        .take()
        .context("Pi RPC stderr was not available")?;

    let stderr_task = tokio::spawn(async move { read_stream_to_string(stderr).await });

    let line = serde_json::to_string(&RpcRequestEnvelope {
        id: request_id.clone(),
        payload: &payload,
    })?;
    stdin.write_all(line.as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    drop(stdin);

    let response = timeout(
        RPC_PROBE_TIMEOUT,
        read_response_from_stdout(&mut stdout, &request_id),
    )
    .await
    .context("timed out waiting for Pi RPC response")??;

    let _ = child.kill().await;
    let _ = child.wait().await;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if response.success.unwrap_or(false) {
        return Ok(response.data.unwrap_or(Value::Null));
    }

    Err(anyhow!(
        "{}",
        response
            .error
            .or_else(|| (!stderr_output.is_empty()).then_some(stderr_output))
            .unwrap_or_else(|| "Pi RPC request failed.".to_string())
    ))
}

async fn probe_rpc(binary_path: &Path, cwd: Option<&Path>) -> Result<()> {
    let _ = run_rpc_once(
        binary_path,
        cwd,
        &["--no-session"],
        json!({
            "type": "get_available_models"
        }),
    )
    .await?;
    Ok(())
}

async fn fetch_available_models(binary_path: &Path, cwd: &Path) -> Result<Vec<PiModel>> {
    let data = run_rpc_once(
        binary_path,
        Some(cwd),
        &["--no-session"],
        json!({
            "type": "get_available_models"
        }),
    )
    .await?;
    Ok(serde_json::from_value::<AvailableModelsResponse>(data)?.models)
}

async fn validate_pi_binary(candidate: &Path) -> Result<String> {
    if !candidate.exists() {
        return Err(anyhow!("Configured Pi binary path does not exist."));
    }

    if !is_executable(candidate) {
        return Err(anyhow!("Configured Pi binary is not executable."));
    }

    let version = run_version_command(candidate).await?;
    probe_rpc(candidate, None).await?;
    Ok(version)
}

async fn resolve_pi_install(shared: &AppState) -> Result<ResolvedPiInstall> {
    let override_path = {
        let state = shared.state.lock().await;
        state
            .preferences
            .pi_binary_path
            .clone()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
    };

    if let Some(candidate) = override_path.clone() {
        let version = match validate_pi_binary(&candidate).await {
            Ok(version) => version,
            Err(error) => {
                return Ok(ResolvedPiInstall {
                    install: install_status(
                        PiInstallState::Broken,
                        Some(candidate),
                        None,
                        Some(error.to_string()),
                    ),
                    binary_path: None,
                });
            }
        };

        return Ok(ResolvedPiInstall {
            install: install_status(
                PiInstallState::Ready,
                Some(candidate.clone()),
                Some(version),
                None,
            ),
            binary_path: Some(candidate),
        });
    }

    let candidates =
        choose_candidate_paths(None, &find_path_candidates(), &common_install_locations());
    if candidates.is_empty() {
        return Ok(ResolvedPiInstall {
            install: install_status(PiInstallState::Missing, None, None, None),
            binary_path: None,
        });
    }

    let mut first_broken: Option<(PathBuf, String)> = None;
    for candidate in candidates {
        if !candidate.exists() || !is_executable(&candidate) {
            continue;
        }

        match validate_pi_binary(&candidate).await {
            Ok(version) => {
                return Ok(ResolvedPiInstall {
                    install: install_status(
                        PiInstallState::Ready,
                        Some(candidate.clone()),
                        Some(version),
                        None,
                    ),
                    binary_path: Some(candidate),
                });
            }
            Err(error) => {
                if first_broken.is_none() {
                    first_broken = Some((candidate, error.to_string()));
                }
            }
        }
    }

    if let Some((candidate, error)) = first_broken {
        return Ok(ResolvedPiInstall {
            install: install_status(PiInstallState::Broken, Some(candidate), None, Some(error)),
            binary_path: None,
        });
    }

    Ok(ResolvedPiInstall {
        install: install_status(PiInstallState::Missing, None, None, None),
        binary_path: None,
    })
}

fn format_context_window(value: Option<u64>) -> String {
    match value {
        Some(window) if window >= 1_000_000 => format!("{}m", window / 1_000_000),
        Some(window) if window >= 1_000 => format!("{}k", window / 1_000),
        Some(window) => window.to_string(),
        None => "unknown".to_string(),
    }
}

fn provider_label(provider_id: &str) -> String {
    match provider_id {
        "google-antigravity" => return "Antigravity".to_string(),
        "google-gemini-cli" => return "Cloud Code Assist".to_string(),
        "openai-codex" => return "Codex".to_string(),
        _ => {}
    }

    provider_id
        .split(['-', '_'])
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                Some(first) => {
                    format!("{}{}", first.to_ascii_uppercase(), chars.as_str())
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn sanitize_model_label(label: &str) -> String {
    const SUFFIXES: [&str; 2] = [" (Antigravity)", " (Cloud Code Assist)"];

    for suffix in SUFFIXES {
        if let Some(stripped) = label.strip_suffix(suffix) {
            return stripped.trim().to_string();
        }
    }

    label.trim().to_string()
}

fn map_models_to_provider_options(models: Vec<PiModel>) -> Vec<ProviderOption> {
    let mut grouped = BTreeMap::<String, Vec<ModelOption>>::new();

    for model in models {
        grouped
            .entry(model.provider.clone())
            .or_default()
            .push(ModelOption {
                id: model.id.clone(),
                label: sanitize_model_label(&model.name),
                provider_id: model.provider.clone(),
                context_window: format_context_window(model.context_window),
                reasoning: model.reasoning,
                available: true,
                provider_source: "pi".to_string(),
            });
    }

    grouped
        .into_iter()
        .map(|(provider_id, mut provider_models)| {
            provider_models.sort_by(|left, right| left.label.cmp(&right.label));
            ProviderOption {
                id: provider_id.clone(),
                label: provider_label(&provider_id),
                status: ProviderStatus::Ready,
                auth_kind: ProviderAuthKind::Local,
                available: true,
                reason: None,
                models: provider_models,
            }
        })
        .collect()
}

fn normalize_workspace_selection(
    provider_id: &mut String,
    model_id: &mut String,
    providers: &[ProviderOption],
) -> bool {
    let Some(first_provider) = providers.first() else {
        return false;
    };

    if let Some(provider) = providers
        .iter()
        .find(|provider| provider.id == *provider_id)
    {
        if provider.models.iter().any(|model| model.id == *model_id) {
            return false;
        }
        if let Some(first_model) = provider.models.first() {
            *model_id = first_model.id.clone();
            return true;
        }
    }

    *provider_id = first_provider.id.clone();
    if let Some(first_model) = first_provider.models.first() {
        *model_id = first_model.id.clone();
    }
    true
}

fn map_codex_effort_to_thinking(effort: &str, fast_mode: bool) -> &'static str {
    if fast_mode {
        return "minimal";
    }

    match effort {
        "extra-high" => "xhigh",
        "medium" => "medium",
        "low" => "low",
        _ => "high",
    }
}

fn map_provider_effort_to_thinking(
    provider_id: &str,
    model_id: &str,
    effort: &str,
    fast_mode: bool,
) -> &'static str {
    if provider_id == "openai-codex" {
        return map_codex_effort_to_thinking(effort, fast_mode);
    }

    if provider_id == "google-antigravity" {
        return match effort {
            "planning" => "high",
            "fast" => "minimal",
            _ if model_id.ends_with("-thinking") || model_id.ends_with("-high") => "high",
            _ if model_id.ends_with("-low") => "low",
            _ => "minimal",
        };
    }

    match effort {
        "extra-high" => "xhigh",
        "medium" => "medium",
        "low" => "low",
        "fast" => "minimal",
        "planning" => "high",
        _ => "high",
    }
}

fn normalize_session_selection(
    selection: &mut SessionModelSelection,
    providers: &[ProviderOption],
) -> bool {
    normalize_workspace_selection(
        &mut selection.provider_id,
        &mut selection.model_id,
        providers,
    )
}

fn resolve_title_selection(
    providers: &[ProviderOption],
    preferred_provider_id: &str,
    preferred_model_id: &str,
) -> Option<(String, String)> {
    if let Some(provider) = providers
        .iter()
        .find(|provider| provider.id == preferred_provider_id)
    {
        if provider
            .models
            .iter()
            .any(|model| model.id == preferred_model_id)
        {
            return Some((
                preferred_provider_id.to_string(),
                preferred_model_id.to_string(),
            ));
        }
    }

    if let Some(provider) = providers
        .iter()
        .find(|provider| provider.id == "openai-codex")
    {
        if let Some(model) = provider
            .models
            .iter()
            .find(|model| model.id == "gpt-5.4-mini")
        {
            return Some((provider.id.clone(), model.id.clone()));
        }
    }

    providers
        .iter()
        .find_map(|provider| {
            provider
                .models
                .iter()
                .find(|model| model.reasoning)
                .map(|model| (provider.id.clone(), model.id.clone()))
        })
        .or_else(|| {
            providers.first().and_then(|provider| {
                provider
                    .models
                    .first()
                    .map(|model| (provider.id.clone(), model.id.clone()))
            })
        })
}

fn prompt_for_mode(prompt: &str, mode: &PromptMode) -> String {
    match mode {
        PromptMode::Build => prompt.to_string(),
        PromptMode::Plan => format!(
            concat!(
                "You are in plan mode. Respond with exactly one <proposed_plan> block and no text outside it.\n",
                "Inside the block, provide concise markdown with a title, summary, key changes, test plan, and assumptions.\n",
                "Do not implement anything, do not include commentary before or after the block.\n\n",
                "User request:\n{}"
            ),
            prompt
        ),
    }
}

fn prompt_for_title(user_message: &str, assistant_message: &str) -> String {
    format!(
        concat!(
            "Generate a short plain-text chat thread title.\n",
            "Requirements:\n",
            "- 2 to 6 words\n",
            "- No quotes\n",
            "- No markdown\n",
            "- No trailing punctuation\n",
            "- Describe the actual task, not the conversation\n\n",
            "First user message:\n{}\n\n",
            "First assistant response:\n{}\n"
        ),
        user_message, assistant_message
    )
}

fn sanitize_generated_title(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty() {
        return None;
    }

    let first_line = trimmed.lines().next()?.trim();
    let cleaned = first_line
        .trim_matches('"')
        .trim_matches('\'')
        .trim_end_matches(['.', '!', '?', ':', ';', ','])
        .trim();

    if cleaned.is_empty() {
        return None;
    }

    let words = cleaned
        .split_whitespace()
        .take(6)
        .collect::<Vec<_>>()
        .join(" ");
    (!words.is_empty()).then_some(words)
}

fn assistant_message_text(message: &PiMessage) -> String {
    match &message.content {
        PiMessageContent::Text(text) => text.clone(),
        PiMessageContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|block| match block {
                PiContentBlock::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(""),
    }
}

fn extract_text_from_prompt_response(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }

    if let Some(title) = value.get("title").and_then(Value::as_str) {
        return Some(title.to_string());
    }

    if let Some(text) = value.get("text").and_then(Value::as_str) {
        return Some(text.to_string());
    }

    if let Some(message) = value.get("message") {
        let parsed = serde_json::from_value::<PiMessage>(message.clone()).ok()?;
        return Some(assistant_message_text(&parsed));
    }

    if let Some(messages) = value.get("messages").and_then(Value::as_array) {
        for message in messages.iter().rev() {
            if let Ok(parsed) = serde_json::from_value::<PiMessage>(message.clone()) {
                if parsed.role == "assistant" {
                    return Some(assistant_message_text(&parsed));
                }
            }
        }
    }

    None
}

fn assistant_message_metadata(
    message: &PiMessage,
    session_file: &str,
    last_known_ready: bool,
    last_error: Option<String>,
) -> SessionRuntimeMetadata {
    SessionRuntimeMetadata {
        provider_id: message.provider.clone(),
        model_id: message.model.clone(),
        pi_session_file: Some(session_file.to_string()),
        last_known_ready,
        last_error,
    }
}

async fn emit_assistant_terminal_event(
    app: &AppHandle,
    shared: &AppState,
    session_handle: &ActiveSessionHandle,
    workspace_id: &str,
    session_id: &str,
    session_file: &str,
    message: &PiMessage,
) -> Result<()> {
    if message.stop_reason.as_deref() == Some("aborted") || session_handle.abort_requested() {
        return Ok(());
    }

    if let Some(error_message) = message.error_message.clone() {
        emit_error(
            app,
            shared,
            Some(workspace_id),
            Some(session_id),
            error_message.clone(),
            Some(assistant_message_metadata(
                message,
                session_file,
                true,
                Some(error_message),
            )),
        )
        .await?;
        return Ok(());
    }

    emit_done(
        app,
        shared,
        workspace_id,
        session_id,
        assistant_message_text(message),
        assistant_message_metadata(message, session_file, true, None),
    )
    .await
}

fn summarize_tool_start(tool_name: &str, args: &Value) -> String {
    if tool_name == "bash" {
        if let Some(command) = args.get("command").and_then(Value::as_str) {
            return command.to_string();
        }
    }

    if args.is_null() {
        return format!("{tool_name} started");
    }

    format!("{tool_name} {}", args)
}

fn tool_result_text(result: &PiToolResult) -> String {
    result
        .content
        .iter()
        .filter_map(|item| match item {
            PiToolResultContent::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("")
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

async fn emit_tool_start(
    app: &AppHandle,
    shared: &AppState,
    workspace_id: &str,
    session_id: &str,
    activity: ToolActivity,
) -> Result<()> {
    {
        let mut state = shared.state.lock().await;
        if let Some(session) = find_session_mut(&mut state, workspace_id, session_id) {
            session.status = SessionStatus::Streaming;
            upsert_tool_activity(session, activity.clone());
            session.updated_at = now_iso();
            storage::save(app, &state)?;
        }
    }

    app.emit(
        "pi://event",
        PiRuntimeEvent::ToolStart {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            activity,
        },
    )?;
    Ok(())
}

async fn emit_tool_update(
    app: &AppHandle,
    shared: &AppState,
    workspace_id: &str,
    session_id: &str,
    activity_id: &str,
    output: String,
    status: ToolStatus,
) -> Result<()> {
    {
        let mut state = shared.state.lock().await;
        if let Some(session) = find_session_mut(&mut state, workspace_id, session_id) {
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
    }

    app.emit(
        "pi://event",
        PiRuntimeEvent::ToolOutput {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            activity_id: activity_id.to_string(),
            output,
            status,
        },
    )?;
    Ok(())
}

async fn emit_status(
    app: &AppHandle,
    shared: &AppState,
    workspace_id: &str,
    session_id: &str,
    label: String,
    detail: Option<String>,
) -> Result<()> {
    {
        let mut state = shared.state.lock().await;
        if let Some(session) = find_session_mut(&mut state, workspace_id, session_id) {
            session.timeline.push(TimelineItem::SystemNotice {
                id: Uuid::new_v4().to_string(),
                created_at: now_iso(),
                title: label.clone(),
                detail: detail.clone().unwrap_or_default(),
            });
            session.updated_at = now_iso();
            storage::save(app, &state)?;
        }
    }

    app.emit(
        "pi://event",
        PiRuntimeEvent::Status {
            workspace_id: Some(workspace_id.to_string()),
            session_id: Some(session_id.to_string()),
            label,
            detail,
        },
    )?;
    Ok(())
}

async fn emit_error(
    app: &AppHandle,
    shared: &AppState,
    workspace_id: Option<&str>,
    session_id: Option<&str>,
    message: String,
    metadata: Option<SessionRuntimeMetadata>,
) -> Result<()> {
    if let (Some(workspace_id), Some(session_id)) = (workspace_id, session_id) {
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
            session.runtime.last_known_ready = false;
            session.runtime.last_error = Some(message.clone());
            session.updated_at = now_iso();
            storage::save(app, &state)?;
        }
    }

    app.emit(
        "pi://event",
        PiRuntimeEvent::Error {
            workspace_id: workspace_id.map(ToOwned::to_owned),
            session_id: session_id.map(ToOwned::to_owned),
            message,
            metadata,
        },
    )?;
    Ok(())
}

async fn emit_done(
    app: &AppHandle,
    shared: &AppState,
    workspace_id: &str,
    session_id: &str,
    content: String,
    metadata: SessionRuntimeMetadata,
) -> Result<()> {
    {
        let mut state = shared.state.lock().await;
        if let Some(session) = find_session_mut(&mut state, workspace_id, session_id) {
            session.timeline.push(TimelineItem::AssistantMessage {
                id: Uuid::new_v4().to_string(),
                created_at: now_iso(),
                content: content.clone(),
                streaming: false,
            });
            session.status = SessionStatus::Idle;
            apply_metadata(session, Some(metadata.clone()));
            session.runtime.last_known_ready = true;
            session.runtime.last_error = None;
            session.updated_at = now_iso();
            storage::save(app, &state)?;
        }
    }

    app.emit(
        "pi://event",
        PiRuntimeEvent::Done {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            content,
            metadata: Some(metadata),
        },
    )?;

    maybe_enqueue_thread_title(
        app.clone(),
        shared.clone(),
        workspace_id.to_string(),
        session_id.to_string(),
    );
    Ok(())
}

fn maybe_enqueue_thread_title(
    app: AppHandle,
    shared: AppState,
    workspace_id: String,
    session_id: String,
) {
    tokio::spawn(async move {
        let _ = generate_thread_title(app, shared, &workspace_id, &session_id).await;
    });
}

async fn process_stdout_line(
    app: &AppHandle,
    shared: &AppState,
    session_handle: &ActiveSessionHandle,
    workspace_id: &str,
    session_id: &str,
    session_file: &str,
    line: &[u8],
    completed: &mut bool,
) -> Result<()> {
    let value: Value = serde_json::from_slice(line).with_context(|| {
        format!(
            "failed to parse Pi RPC line: {}",
            String::from_utf8_lossy(line)
        )
    })?;

    if value.get("type").and_then(Value::as_str) == Some("response") {
        let response: RpcResponseEnvelope = serde_json::from_value(value)?;
        if let Some(request_id) = response.id.clone() {
            if let Some(sender) = session_handle
                .inner
                .pending
                .lock()
                .await
                .remove(&request_id)
            {
                let _ = if response.success.unwrap_or(false) {
                    sender.send(Ok(response.data.unwrap_or(Value::Null)))
                } else {
                    sender.send(Err(response
                        .error
                        .unwrap_or_else(|| "Pi RPC request failed.".to_string())))
                };
            }
        }
        return Ok(());
    }

    let event: RpcEvent = serde_json::from_value(value)?;
    match event {
        RpcEvent::MessageUpdate {
            assistant_message_event: AssistantMessageEvent::TextDelta { delta },
            ..
        } => {
            app.emit(
                "pi://event",
                PiRuntimeEvent::Token {
                    workspace_id: workspace_id.to_string(),
                    session_id: session_id.to_string(),
                    delta,
                    metadata: None,
                },
            )?;
        }
        RpcEvent::MessageUpdate {
            message: Some(message),
            assistant_message_event: AssistantMessageEvent::TextEnd { .. },
        } => {
            if message.role == "assistant" && message.stop_reason.as_deref() != Some("toolUse") {
                *completed = true;
                emit_assistant_terminal_event(
                    app,
                    shared,
                    session_handle,
                    workspace_id,
                    session_id,
                    session_file,
                    &message,
                )
                .await?;
            }
        }
        RpcEvent::MessageUpdate {
            assistant_message_event: AssistantMessageEvent::Done { reason },
            ..
        } => {
            if reason == "tool_use" {
                return Ok(());
            }
        }
        RpcEvent::MessageUpdate {
            assistant_message_event: AssistantMessageEvent::Error { reason },
            ..
        } => {
            if reason == "aborted" {
                session_handle.mark_abort_requested();
            }
        }
        RpcEvent::MessageUpdate {
            assistant_message_event: AssistantMessageEvent::Other,
            ..
        } => {}
        RpcEvent::MessageUpdate {
            assistant_message_event: AssistantMessageEvent::TextEnd { .. },
            ..
        } => {}
        RpcEvent::ToolExecutionStart {
            tool_call_id,
            tool_name,
            args,
        } => {
            emit_tool_start(
                app,
                shared,
                workspace_id,
                session_id,
                ToolActivity {
                    id: tool_call_id.clone(),
                    tool_name: tool_name.clone(),
                    summary: summarize_tool_start(&tool_name, &args),
                    output: None,
                    status: ToolStatus::Running,
                    started_at: now_iso(),
                },
            )
            .await?;
        }
        RpcEvent::ToolExecutionUpdate {
            tool_call_id,
            _tool_name: _,
            _args: _,
            partial_result,
        } => {
            emit_tool_update(
                app,
                shared,
                workspace_id,
                session_id,
                &tool_call_id,
                tool_result_text(&partial_result),
                ToolStatus::Running,
            )
            .await?;
        }
        RpcEvent::ToolExecutionEnd {
            tool_call_id,
            _tool_name: _,
            result,
            is_error,
        } => {
            emit_tool_update(
                app,
                shared,
                workspace_id,
                session_id,
                &tool_call_id,
                tool_result_text(&result),
                if is_error {
                    ToolStatus::Failed
                } else {
                    ToolStatus::Completed
                },
            )
            .await?;
        }
        RpcEvent::CompactionStart { reason } => {
            emit_status(
                app,
                shared,
                workspace_id,
                session_id,
                "Compacting session".to_string(),
                Some(reason),
            )
            .await?;
        }
        RpcEvent::CompactionEnd {
            reason,
            error_message,
        } => {
            emit_status(
                app,
                shared,
                workspace_id,
                session_id,
                "Compaction complete".to_string(),
                error_message.or(Some(reason)),
            )
            .await?;
        }
        RpcEvent::AutoRetryStart {
            attempt,
            max_attempts,
            error_message,
        } => {
            emit_status(
                app,
                shared,
                workspace_id,
                session_id,
                format!("Retrying ({attempt}/{max_attempts})"),
                Some(error_message),
            )
            .await?;
        }
        RpcEvent::AutoRetryEnd {
            success,
            attempt,
            final_error,
        } => {
            emit_status(
                app,
                shared,
                workspace_id,
                session_id,
                if success {
                    format!("Retry succeeded on attempt {attempt}")
                } else {
                    format!("Retry failed on attempt {attempt}")
                },
                final_error,
            )
            .await?;
        }
        RpcEvent::ExtensionError { error, message } => {
            emit_error(
                app,
                shared,
                Some(workspace_id),
                Some(session_id),
                error
                    .or(message)
                    .unwrap_or_else(|| "A Pi extension reported an error.".to_string()),
                Some(SessionRuntimeMetadata {
                    provider_id: None,
                    model_id: None,
                    pi_session_file: Some(session_file.to_string()),
                    last_known_ready: false,
                    last_error: None,
                }),
            )
            .await?;
        }
        RpcEvent::MessageEnd { message } => {
            if message.role == "assistant" {
                *completed = true;
                emit_assistant_terminal_event(
                    app,
                    shared,
                    session_handle,
                    workspace_id,
                    session_id,
                    session_file,
                    &message,
                )
                .await?;
            }
        }
        RpcEvent::AgentEnd { messages } => {
            if !*completed {
                if let Some(message) = messages
                    .iter()
                    .rev()
                    .find(|message| message.role == "assistant")
                {
                    *completed = true;
                    emit_assistant_terminal_event(
                        app,
                        shared,
                        session_handle,
                        workspace_id,
                        session_id,
                        session_file,
                        message,
                    )
                    .await?;
                }
            }
        }
        RpcEvent::AgentStart
        | RpcEvent::TurnStart
        | RpcEvent::TurnEnd { .. }
        | RpcEvent::MessageStart { .. }
        | RpcEvent::Other => {}
    }

    Ok(())
}

async fn handle_session_stdout(
    app: AppHandle,
    shared: AppState,
    session_handle: ActiveSessionHandle,
    workspace_id: String,
    session_id: String,
    session_file: String,
    mut stdout: ChildStdout,
) -> Result<()> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let mut completed = false;

    loop {
        let read = stdout.read(&mut chunk).await?;
        if read == 0 {
            if !buffer.is_empty() {
                let line = std::mem::take(&mut buffer);
                process_stdout_line(
                    &app,
                    &shared,
                    &session_handle,
                    &workspace_id,
                    &session_id,
                    &session_file,
                    &line,
                    &mut completed,
                )
                .await?;
            }
            break;
        }

        buffer.extend_from_slice(&chunk[..read]);

        while let Some(position) = buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = buffer.drain(..=position).collect::<Vec<_>>();
            if matches!(line.last(), Some(&b'\n')) {
                line.pop();
            }
            if matches!(line.last(), Some(&b'\r')) {
                line.pop();
            }
            if line.is_empty() {
                continue;
            }

            process_stdout_line(
                &app,
                &shared,
                &session_handle,
                &workspace_id,
                &session_id,
                &session_file,
                &line,
                &mut completed,
            )
            .await?;

            if completed {
                break;
            }
        }

        if completed {
            break;
        }
    }

    session_handle
        .fail_pending("The Pi RPC session terminated.")
        .await;
    shared
        .runtime
        .remove_session(&session_key(&workspace_id, &session_id))
        .await;

    let aborted = session_handle.abort_requested();
    session_handle.terminate().await;

    if !completed && !aborted {
        emit_error(
            &app,
            &shared,
            Some(&workspace_id),
            Some(&session_id),
            "Pi ended before completing the prompt.".to_string(),
            Some(SessionRuntimeMetadata {
                provider_id: None,
                model_id: None,
                pi_session_file: Some(session_file),
                last_known_ready: false,
                last_error: None,
            }),
        )
        .await?;
    }

    Ok(())
}

async fn handle_session_stderr(
    app: AppHandle,
    workspace_id: String,
    session_id: String,
    stderr: ChildStderr,
) {
    let stderr_output = read_stream_to_string(stderr).await;
    if stderr_output.is_empty() {
        return;
    }

    let _ = app.emit(
        "pi://event",
        PiRuntimeEvent::Status {
            workspace_id: Some(workspace_id),
            session_id: Some(session_id),
            label: "Pi stderr".to_string(),
            detail: Some(stderr_output),
        },
    );
}

async fn generate_thread_title(
    app: AppHandle,
    shared: AppState,
    workspace_id: &str,
    session_id: &str,
) -> Result<()> {
    let (
        workspace_path,
        preferred_provider_id,
        preferred_model_id,
        preferred_effort,
        user_message,
        assistant_message,
    ) = {
        let state = shared.state.lock().await;
        let Some(workspace) = state
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
        else {
            return Ok(());
        };

        let Some(session) = workspace
            .sessions
            .iter()
            .find(|session| session.id == session_id)
        else {
            return Ok(());
        };

        if !state.preferences.auto_title_enabled || session.title != "New thread" {
            return Ok(());
        }

        let user_message = session.timeline.iter().find_map(|item| match item {
            TimelineItem::UserMessage { content, .. } if !content.trim().is_empty() => {
                Some(content.clone())
            }
            _ => None,
        });
        let assistant_message = session.timeline.iter().find_map(|item| match item {
            TimelineItem::AssistantMessage { content, .. } if !content.trim().is_empty() => {
                Some(content.clone())
            }
            _ => None,
        });

        let (Some(user_message), Some(assistant_message)) = (user_message, assistant_message)
        else {
            return Ok(());
        };

        (
            expand_user_path(&workspace.path),
            state.preferences.title_model_provider_id.clone(),
            state.preferences.title_model_id.clone(),
            state.preferences.title_model_effort.clone(),
            user_message,
            assistant_message,
        )
    };

    let resolved = resolve_pi_install(&shared).await?;
    let binary_path = resolved
        .binary_path
        .context("Pi is not installed or failed validation")?;

    let providers = map_models_to_provider_options(
        fetch_available_models(&binary_path, Path::new(&workspace_path)).await?,
    );
    let Some((provider_id, model_id)) =
        resolve_title_selection(&providers, &preferred_provider_id, &preferred_model_id)
    else {
        return Ok(());
    };

    let title_thinking =
        map_provider_effort_to_thinking(&provider_id, &model_id, &preferred_effort, false)
            .to_string();
    let extra_args = vec![
        "--no-session".to_string(),
        "--provider".to_string(),
        provider_id,
        "--model".to_string(),
        model_id,
        "--thinking".to_string(),
        title_thinking,
    ];
    let extra_arg_refs = extra_args.iter().map(String::as_str).collect::<Vec<_>>();
    let response = run_rpc_once(
        &binary_path,
        Some(Path::new(&workspace_path)),
        &extra_arg_refs,
        json!({
            "type": "prompt",
            "message": prompt_for_title(&user_message, &assistant_message)
        }),
    )
    .await?;

    let Some(title) = extract_text_from_prompt_response(&response)
        .and_then(|value| sanitize_generated_title(&value))
    else {
        return Ok(());
    };

    {
        let mut state = shared.state.lock().await;
        let Some(session) = find_session_mut(&mut state, workspace_id, session_id) else {
            return Ok(());
        };

        if session.title != "New thread" {
            return Ok(());
        }

        session.title = title.clone();
        session.updated_at = now_iso();
        storage::save(&app, &state)?;
    }

    app.emit(
        "pi://event",
        PiRuntimeEvent::SessionTitled {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            title,
        },
    )?;

    Ok(())
}

fn session_file_path(app: &AppHandle, workspace_id: &str, session_id: &str) -> Result<PathBuf> {
    let app_data = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data directory")?;
    let directory = app_data.join("pi-sessions").join(workspace_id);
    std::fs::create_dir_all(&directory)?;
    Ok(directory.join(format!("{session_id}.jsonl")))
}

pub fn reconcile_persisted_state(state: &mut crate::models::PersistedAppState) {
    for workspace in &mut state.workspaces {
        for session in &mut workspace.sessions {
            if matches!(session.status, SessionStatus::Streaming) {
                session.status = SessionStatus::Idle;
            }

            let Some(session_file) = session.runtime.pi_session_file.clone() else {
                continue;
            };

            let Ok(raw) = std::fs::read_to_string(&session_file) else {
                continue;
            };

            let mut existing_assistants = session
                .timeline
                .iter()
                .filter_map(|item| match item {
                    TimelineItem::AssistantMessage { content, .. } => Some(content.clone()),
                    _ => None,
                })
                .fold(HashMap::<String, usize>::new(), |mut counts, content| {
                    *counts.entry(content).or_insert(0) += 1;
                    counts
                });

            let mut last_final_assistant: Option<PiMessage> = None;

            for line in raw.lines() {
                let Ok(entry) = serde_json::from_str::<PiSessionEntry>(line) else {
                    continue;
                };
                if entry.kind != "message" {
                    continue;
                }

                let Some(message) = entry.message else {
                    continue;
                };
                if message.role != "assistant" || message.stop_reason.as_deref() == Some("toolUse")
                {
                    continue;
                }

                let content = assistant_message_text(&message);
                if content.trim().is_empty() {
                    continue;
                }

                match existing_assistants.get_mut(&content) {
                    Some(count) if *count > 0 => {
                        *count -= 1;
                    }
                    _ => {
                        session.timeline.push(TimelineItem::AssistantMessage {
                            id: Uuid::new_v4().to_string(),
                            created_at: now_iso(),
                            content,
                            streaming: false,
                        });
                    }
                }

                last_final_assistant = Some(message);
            }

            if let Some(message) = last_final_assistant {
                apply_metadata(
                    session,
                    Some(assistant_message_metadata(
                        &message,
                        &session_file,
                        true,
                        None,
                    )),
                );
                session.runtime.last_known_ready = true;
                session.runtime.last_error = None;
                session.status = SessionStatus::Idle;
            }
        }
    }
}

async fn fetch_workspace_catalog_and_normalize(
    app: &AppHandle,
    shared: &AppState,
    workspace_id: &str,
    binary_path: &Path,
) -> Result<WorkspaceRuntimeCatalogPayload> {
    let workspace_path = {
        let state = shared.state.lock().await;
        state
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
            .map(|workspace| workspace.path.clone())
            .context("workspace not found")?
    };
    let workspace_path = expand_user_path(&workspace_path);

    let providers = map_models_to_provider_options(
        fetch_available_models(binary_path, Path::new(&workspace_path)).await?,
    );

    let (selected_provider_id, selected_model_id) = {
        let mut state = shared.state.lock().await;
        let workspace = state
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == workspace_id)
            .context("workspace not found")?;

        let changed = normalize_workspace_selection(
            &mut workspace.provider_id,
            &mut workspace.model_id,
            &providers,
        );
        let selected_provider_id = workspace.provider_id.clone();
        let selected_model_id = workspace.model_id.clone();

        if changed {
            storage::save(app, &state)?;
        }

        (selected_provider_id, selected_model_id)
    };

    Ok(WorkspaceRuntimeCatalogPayload {
        workspace_id: workspace_id.to_string(),
        providers,
        selected_provider_id,
        selected_model_id,
    })
}

pub async fn bootstrap_runtime(
    _app: AppHandle,
    shared: AppState,
) -> Result<RuntimeBootstrapPayload> {
    Ok(RuntimeBootstrapPayload {
        install: resolve_pi_install(&shared).await?.install,
    })
}

pub async fn healthcheck(_app: AppHandle, shared: AppState) -> Result<RuntimeHealthPayload> {
    Ok(RuntimeHealthPayload {
        install: resolve_pi_install(&shared).await?.install,
    })
}

pub async fn refresh_workspace_runtime_catalog(
    app: AppHandle,
    shared: AppState,
    payload: RefreshWorkspaceRuntimeCatalogPayload,
) -> Result<WorkspaceRuntimeCatalogPayload> {
    let resolved = resolve_pi_install(&shared).await?;
    let binary_path = resolved
        .binary_path
        .context("Pi is not installed or failed validation")?;

    fetch_workspace_catalog_and_normalize(&app, &shared, &payload.workspace_id, &binary_path).await
}

pub async fn launch_prompt_stream(
    app: AppHandle,
    shared: AppState,
    payload: SendPromptPayload,
) -> Result<()> {
    let key = session_key(&payload.workspace_id, &payload.session_id);
    if shared.runtime.get_session(&key).await.is_some() {
        return Err(anyhow!("A Pi prompt is already active for this session."));
    }

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

        if !session.timeline.iter().any(|item| {
            matches!(
                item,
                TimelineItem::UserMessage { id, .. } if id == &payload.user_message_id
            )
        }) {
            session.timeline.push(TimelineItem::UserMessage {
                id: payload.user_message_id.clone(),
                created_at: now_iso(),
                content: payload.prompt.clone(),
            });
        }
        session.status = SessionStatus::Streaming;
        session.runtime.provider_id = None;
        session.runtime.model_id = None;
        session.runtime.pi_session_file = None;
        session.runtime.last_known_ready = false;
        session.runtime.last_error = None;
        session.updated_at = now_iso();

        if let Some(checkpoint) = git::capture_undo_checkpoint(
            &payload.workspace_id,
            &payload.session_id,
            &payload.user_message_id,
            &workspace.path,
        )? {
            storage::save_undo_checkpoint(&app, &checkpoint)?;
        }

        storage::save(&app, &state)?;
    }

    tokio::spawn(run_prompt_stream(app, shared, payload));

    Ok(())
}

async fn run_prompt_stream(app: AppHandle, shared: AppState, payload: SendPromptPayload) {
    let workspace_id = payload.workspace_id.clone();
    let session_id = payload.session_id.clone();
    let prompt = payload.prompt.clone();
    let prompt_mode = payload.mode.clone();
    let key = session_key(&workspace_id, &session_id);

    let result = async {
        let resolved = resolve_pi_install(&shared).await?;
        let binary_path = resolved
            .binary_path
            .context("Pi is not installed or failed validation")?;

        let catalog =
            fetch_workspace_catalog_and_normalize(&app, &shared, &workspace_id, &binary_path)
                .await?;

        if catalog.providers.is_empty() {
            return Err(anyhow!(
                "No Pi models are configured for this workspace. Run `pi` in the project and configure a provider first."
            ));
        }

        let session_file = session_file_path(&app, &workspace_id, &session_id)?;
        let session_file_string = session_file.to_string_lossy().into_owned();

        let (workspace_path, provider_id, model_id, effort, fast_mode) = {
            let mut state = shared.state.lock().await;
            let workspace = state
                .workspaces
                .iter_mut()
                .find(|workspace| workspace.id == workspace_id)
                .context("workspace not found")?;
            let session = workspace
                .sessions
                .iter_mut()
                .find(|session| session.id == session_id)
                .context("session not found")?;

            normalize_session_selection(&mut session.selection, &catalog.providers);

            session.runtime.provider_id = Some(session.selection.provider_id.clone());
            session.runtime.model_id = Some(session.selection.model_id.clone());
            session.runtime.pi_session_file = Some(session_file_string.clone());
            session.runtime.last_known_ready = true;
            session.runtime.last_error = None;
            session.updated_at = now_iso();

            let workspace_path = expand_user_path(&workspace.path);
            let provider_id = session.selection.provider_id.clone();
            let model_id = session.selection.model_id.clone();
            let effort = session.selection.effort.clone();
            let fast_mode = session.selection.fast_mode;
            storage::save(&app, &state)?;

            (workspace_path, provider_id, model_id, effort, fast_mode)
        };

        let mut command = command_for_binary(&binary_path);
        command
            .arg("--mode")
            .arg("rpc")
            .arg("--session")
            .arg(&session_file)
            .arg("--provider")
            .arg(&provider_id)
            .arg("--model")
            .arg(&model_id)
            .arg("--thinking")
            .arg(map_provider_effort_to_thinking(
                &provider_id,
                &model_id,
                &effort,
                fast_mode,
            ))
            .current_dir(&workspace_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = command
            .spawn()
            .with_context(|| format!("failed to spawn Pi from {}", binary_path.to_string_lossy()))?;

        let stdin = child.stdin.take().context("Pi stdin was not available")?;
        let stdout = child.stdout.take().context("Pi stdout was not available")?;
        let stderr = child.stderr.take().context("Pi stderr was not available")?;

        let session_handle = ActiveSessionHandle::new(child, stdin);
        shared
            .runtime
            .insert_session(key.clone(), session_handle.clone())
            .await?;

        tokio::spawn(handle_session_stdout(
            app.clone(),
            shared.clone(),
            session_handle.clone(),
            workspace_id.clone(),
            session_id.clone(),
            session_file_string.clone(),
            stdout,
        ));
        tokio::spawn(handle_session_stderr(
            app.clone(),
            workspace_id.clone(),
            session_id.clone(),
            stderr,
        ));

        let prompt_result: Result<Value> = session_handle
            .request(&json!({
                "type": "prompt",
                "message": prompt_for_mode(&prompt, &prompt_mode),
            }))
            .await;

        if let Err(error) = prompt_result {
            let _ = shared.runtime.remove_session(&key).await;
            session_handle.mark_abort_requested();
            session_handle.terminate().await;
            return Err(error);
        }

        Ok(())
    }
    .await;

    if let Err(error) = result {
        let message = error.to_string();
        let _ = emit_error(
            &app,
            &shared,
            Some(&workspace_id),
            Some(&session_id),
            message,
            Some(SessionRuntimeMetadata {
                provider_id: None,
                model_id: None,
                pi_session_file: None,
                last_known_ready: false,
                last_error: None,
            }),
        )
        .await;
    }
}

pub async fn abort_prompt(
    app: AppHandle,
    shared: AppState,
    payload: AbortPromptPayload,
) -> Result<crate::models::PersistedAppState> {
    let key = session_key(&payload.workspace_id, &payload.session_id);
    let Some(handle) = shared.runtime.get_session(&key).await else {
        return Ok(shared.state.lock().await.clone());
    };

    handle.mark_abort_requested();
    let abort_result: Result<Value> = handle.request(&json!({ "type": "abort" })).await;
    let _ = shared.runtime.remove_session(&key).await;
    handle.terminate().await;

    {
        let mut state = shared.state.lock().await;
        if let Some(session) =
            find_session_mut(&mut state, &payload.workspace_id, &payload.session_id)
        {
            session.status = SessionStatus::Idle;
            session.updated_at = now_iso();
            session.runtime.last_known_ready = true;
            session.runtime.last_error = None;
            storage::save(&app, &state)?;
        }
    }

    emit_status(
        &app,
        &shared,
        &payload.workspace_id,
        &payload.session_id,
        "Aborted".to_string(),
        None,
    )
    .await?;

    abort_result?;
    Ok(shared.state.lock().await.clone())
}

pub async fn resolve_approval(
    app: AppHandle,
    shared: AppState,
    payload: ResolveApprovalPayload,
) -> Result<()> {
    let mut state = shared.state.lock().await;
    let session = find_session_mut(&mut state, &payload.workspace_id, &payload.session_id)
        .context("session not found")?;

    let mut found = false;
    for item in &mut session.timeline {
        if let TimelineItem::ApprovalRequest { approval, .. } = item {
            if approval.id == payload.approval_id {
                approval.status = match payload.decision {
                    ApprovalDecision::Approved => ApprovalState::Approved,
                    ApprovalDecision::Rejected => ApprovalState::Rejected,
                };
                found = true;
            }
        }
    }

    if found {
        session.timeline.push(TimelineItem::ApprovalResolution {
            id: Uuid::new_v4().to_string(),
            created_at: now_iso(),
            approval_id: payload.approval_id,
            decision: payload.decision.clone(),
            summary: "Resolved from historical session data.".to_string(),
        });
        session.status = SessionStatus::Idle;
        session.updated_at = now_iso();
        storage::save(&app, &state)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_selection_prefers_override_then_path_then_common_locations() {
        let common = vec![
            PathBuf::from("/opt/homebrew/bin/pi"),
            PathBuf::from("/usr/local/bin/pi"),
        ];

        assert_eq!(
            choose_candidate_paths(
                Some(PathBuf::from("/custom/pi")),
                &[PathBuf::from("/path/pi")],
                &common
            ),
            vec![PathBuf::from("/custom/pi")]
        );
        assert_eq!(
            choose_candidate_paths(None, &[PathBuf::from("/path/pi")], &common),
            vec![
                PathBuf::from("/path/pi"),
                PathBuf::from("/opt/homebrew/bin/pi"),
                PathBuf::from("/usr/local/bin/pi"),
            ]
        );
    }

    #[test]
    fn version_output_falls_back_to_stderr() {
        assert_eq!(
            select_version_output(b"", b"0.67.68"),
            Some("0.67.68".to_string())
        );
        assert_eq!(
            select_version_output(b"0.67.69", b"warning"),
            Some("0.67.69".to_string())
        );
        assert_eq!(select_version_output(b"", b""), None);
    }

    #[test]
    fn rpc_event_parser_accepts_turn_and_message_start_events() {
        let turn_start: RpcEvent = serde_json::from_value(json!({
            "type": "turn_start"
        }))
        .expect("turn_start should parse");
        assert!(matches!(turn_start, RpcEvent::TurnStart));

        let message_start: RpcEvent = serde_json::from_value(json!({
            "type": "message_start",
            "message": {
                "role": "assistant",
                "content": [],
                "provider": "openai-codex",
                "model": "gpt-5.4-mini",
                "stopReason": "error",
                "errorMessage": "usage limit"
            }
        }))
        .expect("message_start should parse");

        assert!(matches!(message_start, RpcEvent::MessageStart { .. }));
    }

    #[test]
    fn model_catalogs_group_by_provider() {
        let providers = map_models_to_provider_options(vec![
            PiModel {
                id: "gpt-5.4".to_string(),
                name: "GPT-5.4".to_string(),
                provider: "openai".to_string(),
                reasoning: true,
                context_window: Some(256_000),
            },
            PiModel {
                id: "claude-sonnet".to_string(),
                name: "Claude Sonnet".to_string(),
                provider: "anthropic".to_string(),
                reasoning: true,
                context_window: Some(200_000),
            },
            PiModel {
                id: "gpt-5.4-mini".to_string(),
                name: "GPT-5.4 Mini".to_string(),
                provider: "openai".to_string(),
                reasoning: true,
                context_window: Some(128_000),
            },
        ]);

        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].id, "anthropic");
        assert_eq!(providers[1].id, "openai");
        assert_eq!(providers[1].models.len(), 2);
        assert_eq!(providers[1].models[0].context_window, "256k");
    }

    #[test]
    fn invalid_selection_normalizes_to_first_available_model() {
        let providers = vec![ProviderOption {
            id: "openai".to_string(),
            label: "Openai".to_string(),
            status: ProviderStatus::Ready,
            auth_kind: ProviderAuthKind::Local,
            available: true,
            reason: None,
            models: vec![
                ModelOption {
                    id: "gpt-5.4".to_string(),
                    label: "GPT-5.4".to_string(),
                    provider_id: "openai".to_string(),
                    context_window: "256k".to_string(),
                    reasoning: true,
                    available: true,
                    provider_source: "pi".to_string(),
                },
                ModelOption {
                    id: "gpt-5.4-mini".to_string(),
                    label: "GPT-5.4 Mini".to_string(),
                    provider_id: "openai".to_string(),
                    context_window: "128k".to_string(),
                    reasoning: true,
                    available: true,
                    provider_source: "pi".to_string(),
                },
            ],
        }];

        let mut provider_id = "anthropic".to_string();
        let mut model_id = "claude".to_string();
        let changed = normalize_workspace_selection(&mut provider_id, &mut model_id, &providers);

        assert!(changed);
        assert_eq!(provider_id, "openai");
        assert_eq!(model_id, "gpt-5.4");
    }

    #[test]
    fn empty_catalog_keeps_selection_unchanged() {
        let mut provider_id = "openai".to_string();
        let mut model_id = "gpt-5.4".to_string();
        let changed = normalize_workspace_selection(&mut provider_id, &mut model_id, &[]);

        assert!(!changed);
        assert_eq!(provider_id, "openai");
        assert_eq!(model_id, "gpt-5.4");
    }

    #[test]
    fn model_labels_drop_provider_suffixes_but_keep_variants() {
        let providers = map_models_to_provider_options(vec![PiModel {
            id: "gpt-oss-120b-medium".to_string(),
            name: "GPT-OSS 120B Medium (Antigravity)".to_string(),
            provider: "google-antigravity".to_string(),
            reasoning: false,
            context_window: Some(131_072),
        }]);

        assert_eq!(providers[0].models[0].label, "GPT-OSS 120B Medium");
    }

    #[test]
    fn build_mode_prompt_passthrough_is_unchanged() {
        let prompt = "Fix the broken terminal pane.";
        assert_eq!(prompt_for_mode(prompt, &PromptMode::Build), prompt);
    }

    #[test]
    fn plan_mode_prompt_is_wrapped_with_proposed_plan_instruction() {
        let wrapped = prompt_for_mode("Investigate the bug.", &PromptMode::Plan);

        assert!(wrapped.contains("<proposed_plan>"));
        assert!(wrapped.contains("Respond with exactly one"));
        assert!(wrapped.contains("User request:\nInvestigate the bug."));
    }
}
