import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  BootstrapPayload,
  GitSnapshot,
  PersistedAppState,
  PromptMode,
  PiRuntimeEvent,
  RunTerminalCommandResult,
  TerminalEvent,
  RuntimeBootstrapPayload,
  RuntimeHealthPayload,
  WorkspaceRuntimeCatalogPayload,
  WorkspaceRecord,
} from "../domains/types";

export async function bootstrapState() {
  return normalize(await invoke<BootstrapPayload>("bootstrap_state"));
}

export async function createWorkspace(payload: {
  path: string;
  name?: string;
}) {
  return normalize(
    await invoke<WorkspaceRecord>("create_workspace", { payload }),
  );
}

export async function createSession(payload: { workspaceId: string }) {
  return normalize(
    await invoke<PersistedAppState>("create_session", { payload }),
  );
}

export async function refreshGit(payload: { workspaceId: string }) {
  return normalize(
    await invoke<GitSnapshot>("refresh_git_snapshot", { payload }),
  );
}

export async function updatePreferences(
  preferences: PersistedAppState["preferences"],
) {
  return normalize(
    await invoke<PersistedAppState>("update_preferences", { preferences }),
  );
}

export async function updateWorkspaceSettings(payload: {
  workspaceId: string;
  sessionId?: string;
  approvalMode: WorkspaceRecord["approvalMode"];
  providerId: string;
  modelId: string;
  effort?: string;
  fastMode?: boolean;
  policy: WorkspaceRecord["policy"];
}) {
  return normalize(
    await invoke<PersistedAppState>("update_workspace_settings", { payload }),
  );
}

export async function sendPrompt(payload: {
  workspaceId: string;
  sessionId: string;
  userMessageId: string;
  prompt: string;
  mode: PromptMode;
}) {
  return normalize(await invoke<PersistedAppState>("send_prompt", { payload }));
}

export async function bootstrapRuntime() {
  return normalize(await invoke<RuntimeBootstrapPayload>("bootstrap_runtime"));
}

export async function refreshWorkspaceRuntimeCatalog(payload: {
  workspaceId: string;
}) {
  return normalize(
    await invoke<WorkspaceRuntimeCatalogPayload>(
      "refresh_workspace_runtime_catalog",
      { payload },
    ),
  );
}

export async function abortPrompt(payload: {
  workspaceId: string;
  sessionId: string;
}) {
  return normalize(
    await invoke<PersistedAppState>("abort_prompt", { payload }),
  );
}

export async function runtimeHealthcheck() {
  return normalize(await invoke<RuntimeHealthPayload>("runtime_healthcheck"));
}

export async function resolveApproval(payload: {
  workspaceId: string;
  sessionId: string;
  approvalId: string;
  decision: "approved" | "rejected";
}) {
  return normalize(
    await invoke<PersistedAppState>("resolve_approval", { payload }),
  );
}

export async function selectWorkspaceSession(payload: {
  workspaceId: string;
  sessionId: string | null;
}) {
  return normalize(
    await invoke<PersistedAppState>("select_workspace_session", { payload }),
  );
}

export async function renameWorkspace(workspaceId: string, name: string) {
  return normalize(
    await invoke<PersistedAppState>("rename_workspace", {
      payload: { workspaceId, name },
    }),
  );
}

export async function removeWorkspace(workspaceId: string) {
  return normalize(
    await invoke<PersistedAppState>("remove_workspace", {
      payload: { workspaceId },
    }),
  );
}

export async function renameSession(
  workspaceId: string,
  sessionId: string,
  title: string,
) {
  return normalize(
    await invoke<PersistedAppState>("rename_session", {
      payload: { workspaceId, sessionId, title },
    }),
  );
}

export async function archiveSession(workspaceId: string, sessionId: string) {
  return normalize(
    await invoke<PersistedAppState>("archive_session", {
      payload: { workspaceId, sessionId },
    }),
  );
}

export async function restoreSession(workspaceId: string, sessionId: string) {
  return normalize(
    await invoke<PersistedAppState>("restore_session", {
      payload: { workspaceId, sessionId },
    }),
  );
}

export async function deleteSession(workspaceId: string, sessionId: string) {
  return normalize(
    await invoke<PersistedAppState>("delete_session", {
      payload: { workspaceId, sessionId },
    }),
  );
}

export async function readDir(path: string) {
  return await invoke<string[]>("read_dir", { path });
}

export async function openPath(path: string) {
  return await invoke<void>("open_path", { path });
}

export async function ensureTerminalSession(payload: {
  workspaceId: string;
  terminalTabId: string;
}) {
  return await invoke<void>("ensure_terminal_session", { payload });
}

export async function closeTerminalSession(payload: {
  workspaceId: string;
  terminalTabId: string;
}) {
  return await invoke<void>("close_terminal_session", { payload });
}

export async function writeTerminalInput(payload: {
  workspaceId: string;
  terminalTabId: string;
  data: string;
}) {
  return await invoke<void>("write_terminal_input", { payload });
}

export async function resizeTerminal(payload: {
  workspaceId: string;
  terminalTabId: string;
  cols: number;
  rows: number;
}) {
  return await invoke<void>("resize_terminal", { payload });
}

export async function runTerminalCommand(payload: {
  workspaceId: string;
  terminalTabId: string;
  command: string;
  refreshGit?: boolean;
}) {
  return normalize(
    await invoke<RunTerminalCommandResult>("run_terminal_command", { payload }),
  );
}

export async function writeTextFile(payload: {
  path: string;
  content: string;
}) {
  return await invoke<void>("write_text_file", { payload });
}

export async function undoUserTurn(payload: {
  workspaceId: string;
  sessionId: string;
  userMessageId: string;
}) {
  return normalize(
    await invoke<PersistedAppState>("undo_user_turn", { payload }),
  );
}

export async function listenToPiEvents(
  handler: (event: PiRuntimeEvent) => void,
) {
  return listen<PiRuntimeEvent>("pi://event", (event) =>
    handler(normalize(event.payload)),
  );
}

export async function listenToTerminalEvents(
  handler: (event: TerminalEvent) => void,
) {
  return listen<TerminalEvent>("terminal://event", (event) =>
    handler(normalize(event.payload)),
  );
}

function normalize<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry)) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, entry]) => [
        key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
        normalize(entry),
      ],
    );
    return Object.fromEntries(entries) as T;
  }

  return value;
}
