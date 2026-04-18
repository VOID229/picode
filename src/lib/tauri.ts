import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  BootstrapPayload,
  GitSnapshot,
  PersistedAppState,
  PiRuntimeEvent,
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
  approvalMode: WorkspaceRecord["approvalMode"];
  providerId: string;
  modelId: string;
  policy: WorkspaceRecord["policy"];
}) {
  return normalize(
    await invoke<PersistedAppState>("update_workspace_settings", { payload }),
  );
}

export async function sendPrompt(payload: {
  workspaceId: string;
  sessionId: string;
  prompt: string;
}) {
  return normalize(await invoke<PersistedAppState>("send_prompt", { payload }));
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
    await invoke<PersistedAppState>("rename_workspace", { workspaceId, name }),
  );
}

export async function removeWorkspace(workspaceId: string) {
  return normalize(
    await invoke<PersistedAppState>("remove_workspace", { workspaceId }),
  );
}

export async function renameSession(
  workspaceId: string,
  sessionId: string,
  title: string,
) {
  return normalize(
    await invoke<PersistedAppState>("rename_session", {
      workspaceId,
      sessionId,
      title,
    }),
  );
}

export async function deleteSession(workspaceId: string, sessionId: string) {
  return normalize(
    await invoke<PersistedAppState>("delete_session", {
      workspaceId,
      sessionId,
    }),
  );
}

export async function listenToPiEvents(
  handler: (event: PiRuntimeEvent) => void,
) {
  return listen<PiRuntimeEvent>("pi://event", (event) =>
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
