use crate::models::{
    AbortPromptPayload, ApprovalDecision, ApprovalState, ModelOption, PiInstallState,
    PiInstallStatus, PiRuntimeEvent, PromptMode, ProviderAuthKind, ProviderOption, ProviderStatus,
    RefreshWorkspaceRuntimeCatalogPayload, ResolveApprovalPayload,
    ResolveExtensionUiRequestPayload, RuntimeBootstrapPayload, RuntimeHealthPayload,
    SendPromptPayload, SessionIdentityPayload, SessionModelSelection, SessionRuntimeMetadata,
    SessionStats, SessionStatus, TimelineItem, ToolActivity, ToolStatus,
    WorkspaceRuntimeCatalogPayload, expand_user_path, now_iso,
};
use crate::{AppState, git, storage};
use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    env,
    ffi::OsString,
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
const NO_VISIBLE_ASSISTANT_OUTPUT_ERROR: &str = "Pi finished without any visible assistant output.";
const PICODE_QUESTIONS_EXTENSION: &str = r#"
export default function picodeQuestions(pi) {
  const optionSchema = {
    type: "object",
    properties: {
      label: { type: "string" },
      description: { type: "string" }
    },
    required: ["label"],
    additionalProperties: true
  };
  const questionSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      header: { type: "string" },
      question: { type: "string" },
      prompt: { type: "string" },
      options: { type: "array", items: optionSchema }
    },
    required: ["options"],
    additionalProperties: true
  };
  const parameters = {
    type: "object",
    properties: {
      questions: { type: "array", items: questionSchema },
      question: { type: "string" },
      prompt: { type: "string" },
      options: { type: "array", items: optionSchema }
    },
    additionalProperties: true
  };

  function normalize(params) {
    const raw = Array.isArray(params?.questions)
      ? params.questions
      : [{ id: "question", question: params?.question ?? params?.prompt ?? "", options: params?.options ?? [] }];
    return raw.map((item, index) => ({
      id: String(item.id || `question_${index + 1}`),
      header: String(item.header || `Question ${index + 1}`),
      question: String(item.question || item.prompt || ""),
      options: (Array.isArray(item.options) ? item.options : []).slice(0, 3).map((option, optionIndex) => ({
        label: String(option.label || option.value || `Option ${optionIndex + 1}`),
        description: option.description == null ? undefined : String(option.description)
      }))
    })).filter((item) => item.question && item.options.length > 0);
  }

  function register(name) {
    pi.registerTool({
      name,
      label: "Question",
      description: "Ask the user one or more numbered questions with up to three options and a free-text fallback.",
      promptSnippet: "Ask the user a blocking numbered question when you need a decision before continuing",
      promptGuidelines: [
        "Use this tool instead of guessing when user input is required.",
        "Provide 2 or 3 mutually exclusive options when possible."
      ],
      parameters,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const questions = normalize(params);
        if (!ctx.hasUI) {
          return { content: [{ type: "text", text: "Error: UI not available" }], details: { cancelled: true, questions, answers: [] } };
        }
        if (questions.length === 0) {
          return { content: [{ type: "text", text: "Error: no valid questions provided" }], details: { cancelled: true, questions, answers: [] } };
        }

        const resultText = await ctx.ui.editor("__picode_questions__", JSON.stringify({ questions }));
        if (!resultText) {
          return { content: [{ type: "text", text: "User cancelled the questions" }], details: { cancelled: true, questions, answers: [] } };
        }
        let result;
        try {
          result = JSON.parse(resultText);
        } catch {
          result = { answers: [] };
        }
        const answers = Array.isArray(result.answers) ? result.answers : [];
        const lines = answers.map((answer) => {
          const prefix = answer.wasCustom ? "user wrote" : `user selected ${answer.index}`;
          return `${answer.header || answer.id}: ${prefix}: ${answer.value}`;
        });
        return {
          content: [{ type: "text", text: lines.join("\n") || "No answers provided" }],
          details: { cancelled: false, questions, answers }
        };
      }
    });
  }

  register("request_user_input");
  register("question");
  register("questionnaire");
}
"#;

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

    async fn send_notification<P>(&self, payload: &P) -> Result<()>
    where
        P: Serialize + ?Sized,
    {
        let line = serde_json::to_string(payload)?;
        let mut stdin = self.inner.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
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

fn extension_path(app: &AppHandle) -> Result<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data directory")?
        .join("pi-extensions");
    std::fs::create_dir_all(&directory)?;
    let path = directory.join("picode-questions.js");
    std::fs::write(&path, PICODE_QUESTIONS_EXTENSION)?;
    Ok(path)
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

fn command_path_for_binary(binary_path: &Path) -> Option<OsString> {
    let mut entries = Vec::new();

    if let Some(parent) = binary_path.parent() {
        push_candidate(&mut entries, parent.to_path_buf());
    }

    if let Ok(canonical) = std::fs::canonicalize(binary_path) {
        if let Some(parent) = canonical.parent() {
            push_candidate(&mut entries, parent.to_path_buf());
        }
    }

    if let Some(existing_path) = env::var_os("PATH") {
        for entry in env::split_paths(&existing_path) {
            push_candidate(&mut entries, entry);
        }
    }

    env::join_paths(entries).ok()
}

fn configure_command_for_binary(command: &mut Command, binary_path: &Path) {
    if let Some(path) = command_path_for_binary(binary_path) {
        command.env("PATH", path);
    }
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
    configure_command_for_binary(&mut command, binary_path);
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
    configure_command_for_binary(&mut command, binary_path);
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

async fn run_prompt_once_text(
    binary_path: &Path,
    cwd: Option<&Path>,
    extra_args: &[&str],
    prompt: &str,
) -> Result<String> {
    let mut command = command_for_binary(binary_path);
    configure_command_for_binary(&mut command, binary_path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    for arg in extra_args {
        command.arg(arg);
    }
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }

    command.arg("--print").arg(prompt);

    let output = timeout(RPC_PROBE_TIMEOUT, command.output())
        .await
        .context("timed out waiting for Pi print response")??;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Ok(stdout);
        }
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(anyhow!(
        "{}",
        if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "Pi print request failed.".to_string()
        }
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

async fn attempt_thread_title(
    binary_path: &Path,
    workspace_path: &Path,
    provider_id: &str,
    model_id: &str,
    effort: &str,
    prompt: &str,
) -> Option<String> {
    let title_thinking =
        map_provider_effort_to_thinking(provider_id, model_id, effort, false).to_string();
    let extra_args = vec![
        "--no-session".to_string(),
        "--provider".to_string(),
        provider_id.to_string(),
        "--model".to_string(),
        model_id.to_string(),
        "--thinking".to_string(),
        title_thinking,
    ];
    let extra_arg_refs = extra_args.iter().map(String::as_str).collect::<Vec<_>>();
    let response = run_prompt_once_text(binary_path, Some(workspace_path), &extra_arg_refs, prompt)
        .await
        .ok()?;

    sanitize_generated_title(&response)
}

fn prompt_for_mode(prompt: &str, mode: &PromptMode) -> String {
    match mode {
        PromptMode::Build => prompt.to_string(),
        PromptMode::Plan => format!(
            concat!(
                "You are in plan mode. Do not implement code changes.\n",
                "Before writing the plan, ground yourself in the task: ask clarifying questions with request_user_input when the requirements are ambiguous, or inspect relevant files when local code context is needed.\n",
                "Only after you understand the core grounding, send exactly one assistant message containing one <proposed_plan> block and no text outside it.\n",
                "Inside the block, provide concise markdown with a title, summary, key changes, test plan, and assumptions.\n",
                "Do not call request_user_input to ask about implementation until after the complete <proposed_plan> block has been sent to the user.\n",
                "After the full plan message is sent, immediately call request_user_input with exactly two options before ending the turn.\n",
                "The request_user_input call must ask whether to proceed with the proposed plan and must provide exactly two options: \"Implement plan\" and \"No, do something differently\".\n",
                "The second option must clearly allow the user to free-type what should change, and you must wait for that tool result before doing anything else.\n\n",
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

fn prompt_for_commit_message(diff_context: &str, custom_instructions: Option<&str>) -> String {
    format!(
        concat!(
            "Generate a concise git commit subject for the following changes.\n",
            "Requirements:\n",
            "- One line only\n",
            "- Imperative mood\n",
            "- No markdown\n",
            "- No quotes\n",
            "- 72 characters or less\n\n",
            "Custom instructions:\n{}\n\n",
            "Changes:\n{}\n"
        ),
        custom_instructions
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("None"),
        diff_context
    )
}

fn prompt_for_pr_message(context: &str, custom_instructions: Option<&str>) -> String {
    format!(
        concat!(
            "Generate a GitHub pull request title and body for the following branch.\n",
            "Return strict JSON with keys title and body. Do not include markdown fences.\n",
            "The title should be concise. The body should include a short summary and test notes when inferable.\n\n",
            "Custom instructions:\n{}\n\n",
            "Branch context:\n{}\n"
        ),
        custom_instructions
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("None"),
        context
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

fn sanitize_generated_commit_message(value: &str) -> Option<String> {
    sanitize_generated_title(value).map(|title| {
        let mut subject = title.lines().next().unwrap_or("").trim().to_string();
        if subject.len() > 72 {
            subject.truncate(72);
            subject = subject.trim_end().to_string();
        }
        subject
    })
}

fn parse_generated_pr_message(value: &str) -> Option<(String, String)> {
    let parsed: Value = serde_json::from_str(value.trim()).ok()?;
    let title = parsed
        .get("title")
        .and_then(Value::as_str)
        .and_then(sanitize_generated_title)?;
    let body = parsed
        .get("body")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|body| !body.is_empty())
        .unwrap_or("Generated by Picode.")
        .to_string();
    Some((title, body))
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

enum AssistantTerminalEvent {
    Done(String),
    Error(String),
    Ignore,
}

fn classify_assistant_message(message: &PiMessage) -> AssistantTerminalEvent {
    if message.stop_reason.as_deref() == Some("toolUse") {
        return AssistantTerminalEvent::Ignore;
    }

    if let Some(error_message) = message.error_message.clone() {
        return AssistantTerminalEvent::Error(error_message);
    }

    let content = assistant_message_text(message);
    if content.trim().is_empty() {
        return AssistantTerminalEvent::Ignore;
    }

    AssistantTerminalEvent::Done(content)
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
) -> Result<bool> {
    if message.stop_reason.as_deref() == Some("aborted") || session_handle.abort_requested() {
        return Ok(false);
    }

    match classify_assistant_message(message) {
        AssistantTerminalEvent::Error(error_message) => {
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
            Ok(true)
        }
        AssistantTerminalEvent::Done(content) => {
            emit_done(
                app,
                shared,
                workspace_id,
                session_id,
                content,
                assistant_message_metadata(message, session_file, true, None),
            )
            .await?;
            Ok(true)
        }
        AssistantTerminalEvent::Ignore => Ok(false),
    }
}

async fn apply_metadata_from_stream_message(
    app: &AppHandle,
    shared: &AppState,
    workspace_id: &str,
    session_id: &str,
    message: &PiMessage,
    session_file: &str,
) -> Result<()> {
    if message.provider.is_none() && message.model.is_none() {
        return Ok(());
    }

    {
        let mut state = shared.state.lock().await;
        if let Some(session) = find_session_mut(&mut state, workspace_id, session_id) {
            apply_metadata(
                session,
                Some(assistant_message_metadata(
                    message,
                    session_file,
                    true,
                    None,
                )),
            );
            session.runtime.last_known_ready = true;
            session.runtime.last_error = None;
            session.updated_at = now_iso();
            storage::save(app, &state)?;
        }
    }

    Ok(())
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
            session.runtime.provider_id = metadata.provider_id.clone();
        }
        if metadata.model_id.is_some() {
            session.runtime.model_id = metadata.model_id.clone();
        }
        if metadata.pi_session_file.is_some() {
            session.runtime.pi_session_file = metadata.pi_session_file;
        }
        session.runtime.last_known_ready = metadata.last_known_ready;
        if metadata.last_error.is_some() {
            session.runtime.last_error = metadata.last_error;
        }
        sync_session_selection_from_runtime_metadata(session);
    }
}

fn sync_session_selection_from_runtime_metadata(session: &mut crate::models::ChatSession) {
    let Some(provider_id) = session.runtime.provider_id.clone() else {
        return;
    };
    let Some(model_id) = session.runtime.model_id.clone() else {
        return;
    };

    if provider_id.trim().is_empty() || model_id.trim().is_empty() {
        return;
    }

    session.selection.provider_id = provider_id;
    session.selection.model_id = model_id;
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
            let existing_streaming = session.timeline.iter_mut().rev().find(|item| {
                matches!(
                    item,
                    TimelineItem::AssistantMessage {
                        streaming: true,
                        ..
                    }
                )
            });

            if let Some(TimelineItem::AssistantMessage {
                content: existing_content,
                streaming,
                ..
            }) = existing_streaming
            {
                if !content.trim().is_empty() {
                    *existing_content = content.clone();
                }
                *streaming = false;
            } else {
                session.timeline.push(TimelineItem::AssistantMessage {
                    id: Uuid::new_v4().to_string(),
                    created_at: now_iso(),
                    content: content.clone(),
                    streaming: false,
                });
            }
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

pub fn enqueue_thread_title(
    app: AppHandle,
    shared: AppState,
    workspace_id: String,
    session_id: String,
) {
    maybe_enqueue_thread_title(app, shared, workspace_id, session_id);
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

    if value.get("type").and_then(Value::as_str) == Some("extension_ui_request") {
        app.emit(
            "pi://event",
            PiRuntimeEvent::ExtensionUiRequest {
                workspace_id: workspace_id.to_string(),
                session_id: session_id.to_string(),
                request: value,
            },
        )?;
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
            if message.role == "assistant" {
                apply_metadata_from_stream_message(
                    app,
                    shared,
                    workspace_id,
                    session_id,
                    &message,
                    session_file,
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
                apply_metadata_from_stream_message(
                    app,
                    shared,
                    workspace_id,
                    session_id,
                    &message,
                    session_file,
                )
                .await?;
            }
        }
        RpcEvent::AgentEnd { messages } => {
            if !*completed {
                if let Some(message) = messages.iter().rev().find(|message| {
                    message.role == "assistant"
                        && !matches!(
                            classify_assistant_message(message),
                            AssistantTerminalEvent::Ignore
                        )
                }) {
                    if emit_assistant_terminal_event(
                        app,
                        shared,
                        session_handle,
                        workspace_id,
                        session_id,
                        session_file,
                        message,
                    )
                    .await?
                    {
                        *completed = true;
                    }
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
            NO_VISIBLE_ASSISTANT_OUTPUT_ERROR.to_string(),
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
        fallback_provider_id,
        fallback_model_id,
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

        let Some((user_message, assistant_message)) = session_title_seed(session) else {
            return Ok(());
        };

        (
            expand_user_path(&workspace.path),
            state.preferences.title_model_provider_id.clone(),
            state.preferences.title_model_id.clone(),
            state.preferences.title_model_fallback_provider_id.clone(),
            state.preferences.title_model_fallback_id.clone(),
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
    let fallback_selection =
        resolve_title_selection(&providers, &fallback_provider_id, &fallback_model_id);
    let prompt = prompt_for_title(&user_message, &assistant_message);

    let mut title = attempt_thread_title(
        &binary_path,
        Path::new(&workspace_path),
        &provider_id,
        &model_id,
        &preferred_effort,
        &prompt,
    )
    .await;

    if title.is_none() {
        if let Some((fallback_provider_id, fallback_model_id)) = fallback_selection {
            title = attempt_thread_title(
                &binary_path,
                Path::new(&workspace_path),
                &fallback_provider_id,
                &fallback_model_id,
                &preferred_effort,
                &prompt,
            )
            .await;
        }
    }

    let Some(title) = title else {
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

            session.timeline.retain(|item| {
                !matches!(
                    item,
                    TimelineItem::AssistantMessage { content, .. } if content.trim().is_empty()
                )
            });

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

fn session_title_seed(session: &crate::models::ChatSession) -> Option<(String, String)> {
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

    Some((user_message?, assistant_message?))
}

pub fn sessions_requiring_title_backfill(
    state: &crate::models::PersistedAppState,
) -> Vec<(String, String)> {
    if !state.preferences.auto_title_enabled {
        return Vec::new();
    }

    state
        .workspaces
        .iter()
        .flat_map(|workspace| {
            workspace.sessions.iter().filter_map(|session| {
                if session.title == "New thread" && session_title_seed(session).is_some() {
                    Some((workspace.id.clone(), session.id.clone()))
                } else {
                    None
                }
            })
        })
        .collect()
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
        let global_selection = state.preferences.model_selection_scope == "global";

        let (selected_provider_id, selected_model_id, changed) = if global_selection {
            state
                .workspaces
                .iter()
                .find(|workspace| workspace.id == workspace_id)
                .context("workspace not found")?;
            let mut provider_id = state.preferences.provider_id.clone();
            let mut model_id = state.preferences.model_id.clone();
            let changed =
                normalize_workspace_selection(&mut provider_id, &mut model_id, &providers);
            if changed {
                state.preferences.provider_id = provider_id.clone();
                state.preferences.model_id = model_id.clone();
            }
            (provider_id, model_id, changed)
        } else {
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
            (
                workspace.provider_id.clone(),
                workspace.model_id.clone(),
                changed,
            )
        };

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

pub async fn generate_git_commit_message(
    shared: &AppState,
    workspace_path: &str,
    diff_context: &str,
    custom_instructions: Option<&str>,
) -> Result<Option<String>> {
    let (
        enabled,
        preferred_provider_id,
        preferred_model_id,
        fallback_provider_id,
        fallback_model_id,
        effort,
    ) = {
        let state = shared.state.lock().await;
        (
            state.preferences.auto_git_messages_enabled,
            state.preferences.git_message_model_provider_id.clone(),
            state.preferences.git_message_model_id.clone(),
            state
                .preferences
                .git_message_model_fallback_provider_id
                .clone(),
            state.preferences.git_message_model_fallback_id.clone(),
            state.preferences.git_message_model_effort.clone(),
        )
    };
    if !enabled || diff_context.trim().is_empty() {
        return Ok(None);
    }

    let resolved = resolve_pi_install(shared).await?;
    let binary_path = resolved
        .binary_path
        .context("Pi is not installed or failed validation")?;
    let providers = map_models_to_provider_options(
        fetch_available_models(&binary_path, Path::new(workspace_path)).await?,
    );
    let Some((provider_id, model_id)) =
        resolve_title_selection(&providers, &preferred_provider_id, &preferred_model_id)
    else {
        return Ok(None);
    };
    let fallback_selection =
        resolve_title_selection(&providers, &fallback_provider_id, &fallback_model_id);
    let prompt = prompt_for_commit_message(diff_context, custom_instructions);

    let mut value = run_prompt_once_text(
        &binary_path,
        Some(Path::new(workspace_path)),
        &[
            "--no-session",
            "--provider",
            &provider_id,
            "--model",
            &model_id,
            "--thinking",
            map_provider_effort_to_thinking(&provider_id, &model_id, &effort, false),
        ],
        &prompt,
    )
    .await
    .ok();
    if value.is_none() {
        if let Some((fallback_provider_id, fallback_model_id)) = fallback_selection {
            value = run_prompt_once_text(
                &binary_path,
                Some(Path::new(workspace_path)),
                &[
                    "--no-session",
                    "--provider",
                    &fallback_provider_id,
                    "--model",
                    &fallback_model_id,
                    "--thinking",
                    map_provider_effort_to_thinking(
                        &fallback_provider_id,
                        &fallback_model_id,
                        &effort,
                        false,
                    ),
                ],
                &prompt,
            )
            .await
            .ok();
        }
    }
    Ok(value.and_then(|message| sanitize_generated_commit_message(&message)))
}

pub async fn generate_git_pr_message(
    shared: &AppState,
    workspace_path: &str,
    branch_context: &str,
    custom_instructions: Option<&str>,
) -> Result<Option<(String, String)>> {
    let (
        enabled,
        preferred_provider_id,
        preferred_model_id,
        fallback_provider_id,
        fallback_model_id,
        effort,
    ) = {
        let state = shared.state.lock().await;
        (
            state.preferences.auto_git_messages_enabled,
            state.preferences.git_message_model_provider_id.clone(),
            state.preferences.git_message_model_id.clone(),
            state
                .preferences
                .git_message_model_fallback_provider_id
                .clone(),
            state.preferences.git_message_model_fallback_id.clone(),
            state.preferences.git_message_model_effort.clone(),
        )
    };
    if !enabled || branch_context.trim().is_empty() {
        return Ok(None);
    }

    let resolved = resolve_pi_install(shared).await?;
    let binary_path = resolved
        .binary_path
        .context("Pi is not installed or failed validation")?;
    let providers = map_models_to_provider_options(
        fetch_available_models(&binary_path, Path::new(workspace_path)).await?,
    );
    let Some((provider_id, model_id)) =
        resolve_title_selection(&providers, &preferred_provider_id, &preferred_model_id)
    else {
        return Ok(None);
    };
    let fallback_selection =
        resolve_title_selection(&providers, &fallback_provider_id, &fallback_model_id);
    let prompt = prompt_for_pr_message(branch_context, custom_instructions);

    let mut response = run_prompt_once_text(
        &binary_path,
        Some(Path::new(workspace_path)),
        &[
            "--no-session",
            "--provider",
            &provider_id,
            "--model",
            &model_id,
            "--thinking",
            map_provider_effort_to_thinking(&provider_id, &model_id, &effort, false),
        ],
        &prompt,
    )
    .await
    .ok();

    if response.is_none() {
        if let Some((fallback_provider_id, fallback_model_id)) = fallback_selection {
            response = run_prompt_once_text(
                &binary_path,
                Some(Path::new(workspace_path)),
                &[
                    "--no-session",
                    "--provider",
                    &fallback_provider_id,
                    "--model",
                    &fallback_model_id,
                    "--thinking",
                    map_provider_effort_to_thinking(
                        &fallback_provider_id,
                        &fallback_model_id,
                        &effort,
                        false,
                    ),
                ],
                &prompt,
            )
            .await
            .ok();
        }
    }

    Ok(response.as_deref().and_then(parse_generated_pr_message))
}

pub async fn resolve_extension_ui_request(
    shared: AppState,
    payload: ResolveExtensionUiRequestPayload,
) -> Result<()> {
    let key = session_key(&payload.workspace_id, &payload.session_id);
    let handle = shared
        .runtime
        .get_session(&key)
        .await
        .context("No active Pi session is waiting for a UI response.")?;
    let mut response = serde_json::Map::new();
    response.insert(
        "type".to_string(),
        Value::String("extension_ui_response".to_string()),
    );
    response.insert("id".to_string(), Value::String(payload.request_id));
    if let Value::Object(entries) = payload.response {
        for (key, value) in entries {
            response.insert(key, value);
        }
    } else {
        response.insert("value".to_string(), payload.response);
    }
    handle.send_notification(&Value::Object(response)).await
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
                images: payload.images.clone(),
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
        let questions_extension = extension_path(&app)?;

        let (workspace_path, provider_id, model_id, effort, fast_mode) = {
            let mut state = shared.state.lock().await;
            let global_selection =
                (state.preferences.model_selection_scope == "global").then(|| {
                    (
                        state.preferences.provider_id.clone(),
                        state.preferences.model_id.clone(),
                        state.preferences.effort.clone(),
                        state.preferences.fast_mode,
                    )
                });
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

            if let Some((provider_id, model_id, effort, fast_mode)) = global_selection {
                session.selection.provider_id = provider_id;
                session.selection.model_id = model_id;
                session.selection.effort = effort;
                session.selection.fast_mode = fast_mode;
            }

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
        configure_command_for_binary(&mut command, &binary_path);
        command
            .arg("--mode")
            .arg("rpc")
            .arg("--extension")
            .arg(&questions_extension)
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

async fn stop_prompt_internal(
    app: &AppHandle,
    shared: &AppState,
    payload: &AbortPromptPayload,
    emit_aborted_status: bool,
    ignore_abort_error: bool,
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
            storage::save(app, &state)?;
        }
    }

    if emit_aborted_status {
        emit_status(
            app,
            shared,
            &payload.workspace_id,
            &payload.session_id,
            "Aborted".to_string(),
            None,
        )
        .await?;
    }

    if !ignore_abort_error {
        abort_result?;
    }

    Ok(shared.state.lock().await.clone())
}

pub async fn abort_prompt(
    app: AppHandle,
    shared: AppState,
    payload: AbortPromptPayload,
) -> Result<crate::models::PersistedAppState> {
    stop_prompt_internal(&app, &shared, &payload, true, false).await
}

pub async fn get_session_stats(
    shared: AppState,
    payload: SessionIdentityPayload,
) -> Result<SessionStats> {
    let key = session_key(&payload.workspace_id, &payload.session_id);
    let Some(handle) = shared.runtime.get_session(&key).await else {
        return Err(anyhow!("Session is not active."));
    };

    let stats_value: Value = handle
        .request(&json!({ "type": "get_session_stats" }))
        .await?;

    Ok(serde_json::from_value(stats_value)?)
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
    use crate::models::default_state;

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
    fn classify_assistant_message_ignores_tool_use_and_empty_content() {
        let tool_use = PiMessage {
            role: "assistant".to_string(),
            content: PiMessageContent::Blocks(vec![]),
            provider: Some("openai-codex".to_string()),
            model: Some("gpt-5.4".to_string()),
            stop_reason: Some("toolUse".to_string()),
            error_message: None,
        };
        assert!(matches!(
            classify_assistant_message(&tool_use),
            AssistantTerminalEvent::Ignore
        ));

        let empty = PiMessage {
            role: "assistant".to_string(),
            content: PiMessageContent::Blocks(vec![PiContentBlock::Other]),
            provider: Some("openai-codex".to_string()),
            model: Some("gpt-5.4".to_string()),
            stop_reason: None,
            error_message: None,
        };
        assert!(matches!(
            classify_assistant_message(&empty),
            AssistantTerminalEvent::Ignore
        ));
    }

    #[test]
    fn classify_assistant_message_prefers_explicit_errors() {
        let message = PiMessage {
            role: "assistant".to_string(),
            content: PiMessageContent::Blocks(vec![]),
            provider: Some("openai-codex".to_string()),
            model: Some("gpt-5.4".to_string()),
            stop_reason: Some("error".to_string()),
            error_message: Some("Connection error.".to_string()),
        };

        match classify_assistant_message(&message) {
            AssistantTerminalEvent::Error(error) => {
                assert_eq!(error, "Connection error.".to_string())
            }
            _ => panic!("expected error classification"),
        }
    }

    #[test]
    fn sessions_requiring_title_backfill_only_includes_real_replies() {
        let mut state = default_state("/tmp/demo".to_string(), "Demo".to_string());
        {
            let workspace = state.workspaces.first_mut().expect("workspace");
            let session = workspace.sessions.first_mut().expect("session");
            session.timeline = vec![
                TimelineItem::UserMessage {
                    id: "user-1".to_string(),
                    created_at: now_iso(),
                    content: "hello".to_string(),
                    images: Vec::new(),
                },
                TimelineItem::AssistantMessage {
                    id: "assistant-1".to_string(),
                    created_at: now_iso(),
                    content: "world".to_string(),
                    streaming: false,
                },
            ];
        }

        let queued = sessions_requiring_title_backfill(&state);
        assert_eq!(queued.len(), 1);

        state.workspaces[0].sessions[0]
            .timeline
            .push(TimelineItem::AssistantMessage {
                id: "assistant-2".to_string(),
                created_at: now_iso(),
                content: "".to_string(),
                streaming: false,
            });
        reconcile_persisted_state(&mut state);
        let session = &state.workspaces[0].sessions[0];
        assert_eq!(
            session
                .timeline
                .iter()
                .filter(|item| matches!(item, TimelineItem::AssistantMessage { .. }))
                .count(),
            1
        );
    }

    #[test]
    fn apply_metadata_restores_session_selection_from_runtime_metadata() {
        let mut state = default_state("/tmp/demo".to_string(), "Demo".to_string());
        let workspace = state.workspaces.first_mut().expect("workspace");
        let session = workspace.sessions.first_mut().expect("session");

        session.selection.provider_id = "openai-codex".to_string();
        session.selection.model_id = "gpt-5.4".to_string();
        session.runtime.provider_id = Some("google-antigravity".to_string());
        session.runtime.model_id = Some("claude-sonnet-4-6".to_string());

        apply_metadata(
            session,
            Some(SessionRuntimeMetadata {
                provider_id: Some("google-antigravity".to_string()),
                model_id: Some("claude-sonnet-4-6".to_string()),
                pi_session_file: None,
                last_known_ready: true,
                last_error: None,
            }),
        );

        assert_eq!(session.selection.provider_id, "google-antigravity");
        assert_eq!(session.selection.model_id, "claude-sonnet-4-6");
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
    fn generated_commit_subject_is_sanitized() {
        assert_eq!(
            sanitize_generated_commit_message(
                "\"Add git modal and question composer with extra words that should be trimmed\"",
            ),
            Some("Add git modal and question composer".to_string())
        );
        assert_eq!(sanitize_generated_commit_message("   "), None);
    }

    #[test]
    fn generated_pr_message_parses_sanitized_json() {
        assert_eq!(
            parse_generated_pr_message(
                r#"{"title":"Implement git workflow popup.","body":"Adds modal and generated text."}"#,
            ),
            Some((
                "Implement git workflow popup".to_string(),
                "Adds modal and generated text.".to_string(),
            ))
        );
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
        assert!(wrapped.contains("Before writing the plan, ground yourself"));
        assert!(wrapped.contains("call request_user_input with exactly two options"));
        assert!(wrapped.contains("\"Implement plan\""));
        assert!(wrapped.contains("\"No, do something differently\""));
        assert!(wrapped.contains("User request:\nInvestigate the bug."));
    }
}
