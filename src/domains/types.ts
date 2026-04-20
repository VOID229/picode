export type ThemeId =
  | "dark"
  | "light"
  | "catppuccin"
  | "nord"
  | "gruvbox"
  | "solarized";

export type ApprovalMode = "supervised" | "auto-accept-edits" | "full-access";
export type ProviderStatus =
  | "ready"
  | "requires_oauth"
  | "requires_api_key"
  | "requires_local_runtime"
  | "unavailable"
  | "error";
export type ProviderAuthKind = "oauth" | "api-key" | "local";

export type TimelineItemKind =
  | "user-message"
  | "assistant-message"
  | "tool-activity"
  | "approval-request"
  | "approval-resolution"
  | "warning"
  | "error"
  | "system-notice";

export interface ProviderOption {
  id: string;
  label: string;
  status: ProviderStatus;
  authKind: ProviderAuthKind;
  available: boolean;
  reason?: string;
  models: ModelOption[];
}

export interface ModelOption {
  id: string;
  label: string;
  providerId: string;
  contextWindow: string;
  available: boolean;
  providerSource: string;
}

export interface ApprovalPolicy {
  allowedPaths: string[];
  allowedCommands: string[];
  envPassthrough: string[];
  networkEnabled: boolean;
}

export interface ApprovalRequest {
  id: string;
  title: string;
  reason: string;
  command?: string;
  path?: string;
  diffPreview?: string;
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
}

export interface ToolActivity {
  id: string;
  toolName: string;
  summary: string;
  output?: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
}

export interface TimelineItemBase {
  id: string;
  kind: TimelineItemKind;
  createdAt: string;
}

export interface UserMessageItem extends TimelineItemBase {
  kind: "user-message";
  content: string;
}

export interface AssistantMessageItem extends TimelineItemBase {
  kind: "assistant-message";
  content: string;
  streaming?: boolean;
}

export interface ToolActivityItem extends TimelineItemBase {
  kind: "tool-activity";
  activity: ToolActivity;
}

export interface ApprovalRequestItem extends TimelineItemBase {
  kind: "approval-request";
  approval: ApprovalRequest;
}

export interface ApprovalResolutionItem extends TimelineItemBase {
  kind: "approval-resolution";
  approvalId: string;
  decision: "approved" | "rejected";
  summary: string;
}

export interface NoticeItem extends TimelineItemBase {
  kind: "warning" | "error" | "system-notice";
  title: string;
  detail: string;
}

export type TimelineItem =
  | UserMessageItem
  | AssistantMessageItem
  | ToolActivityItem
  | ApprovalRequestItem
  | ApprovalResolutionItem
  | NoticeItem;

export interface ChatSession {
  id: string;
  title: string;
  branchLabel?: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "streaming" | "awaiting-approval" | "error";
  archivedAt?: string;
  runtime: SessionRuntimeMetadata;
  timeline: TimelineItem[];
}

export interface SessionRuntimeMetadata {
  providerId?: string;
  modelId?: string;
  piSessionFile?: string;
  lastKnownReady: boolean;
  lastError?: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  path: string;
  pinned: boolean;
  recentRank: number;
  approvalMode: ApprovalMode;
  policy: ApprovalPolicy;
  providerId: string;
  modelId: string;
  effort: string;
  fastMode: boolean;
  sessions: ChatSession[];
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  patch: string;
}

export interface GitSnapshot {
  branch: string;
  summary: string;
  isRepo: boolean;
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  files: DiffFile[];
}

export type TerminalConnectionState =
  | "idle"
  | "connecting"
  | "ready"
  | "error"
  | "exited";

export interface TerminalCommandState {
  id: string;
  command: string;
  exitCode?: number;
}

export interface TerminalSessionState {
  workspaceId: string;
  open: boolean;
  status: TerminalConnectionState;
  buffer: string;
  activeCommand?: TerminalCommandState;
  lastCommand?: TerminalCommandState;
  error?: string;
}

export interface LayoutPreferences {
  diffMode: "split" | "inline";
  gitPanelOpen: boolean;
  diffPanelOpen: boolean;
}

export interface AppPreferences {
  theme: ThemeId;
  providerId: string;
  modelId: string;
  approvalMode: ApprovalMode;
  effort: string;
  fastMode: boolean;
  piBinaryPath?: string;
  layout: LayoutPreferences;
}

export interface PersistedAppState {
  schemaVersion: number;
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  workspaces: WorkspaceRecord[];
  preferences: AppPreferences;
  providers: ProviderOption[];
}

export interface BootstrapPayload {
  state: PersistedAppState;
  git: Record<string, GitSnapshot>;
}

export interface RuntimeBootstrapPayload {
  install: PiInstallStatus;
}

export interface RuntimeHealthPayload {
  install: PiInstallStatus;
}

export interface RunTerminalCommandResult {
  commandId: string;
}

export type PiInstallState = "ready" | "missing" | "broken";

export interface PiInstallStatus {
  status: PiInstallState;
  binaryPath?: string;
  version?: string;
  error?: string;
  installUrl: string;
  installCommand: string;
}

export interface WorkspaceRuntimeCatalogPayload {
  workspaceId: string;
  providers: ProviderOption[];
  selectedProviderId: string;
  selectedModelId: string;
}

export type PiRuntimeEvent =
  | {
      type: "runtime-ready";
      piHome: string;
      version?: string;
    }
  | {
      type: "catalog";
      providers: ProviderOption[];
    }
  | {
      type: "token";
      workspaceId: string;
      sessionId: string;
      delta: string;
      metadata?: SessionRuntimeMetadata;
    }
  | {
      type: "tool-start";
      workspaceId: string;
      sessionId: string;
      activity: ToolActivity;
    }
  | {
      type: "tool-output";
      workspaceId: string;
      sessionId: string;
      activityId: string;
      output: string;
      status: ToolActivity["status"];
    }
  | {
      type: "approval-requested";
      workspaceId: string;
      sessionId: string;
      approval: ApprovalRequest;
    }
  | {
      type: "approval-resolved";
      workspaceId: string;
      sessionId: string;
      approvalId: string;
      decision: "approved" | "rejected";
      summary: string;
    }
  | {
      type: "status";
      workspaceId?: string;
      sessionId?: string;
      label: string;
      detail?: string;
    }
  | {
      type: "error";
      workspaceId?: string;
      sessionId?: string;
      message: string;
      metadata?: SessionRuntimeMetadata;
    }
  | {
      type: "done";
      workspaceId: string;
      sessionId: string;
      content: string;
      metadata?: SessionRuntimeMetadata;
    }
  | {
      type: "auth-browser-open";
      providerId: string;
      url: string;
      instructions?: string;
    }
  | {
      type: "auth-manual-input-requested";
      providerId: string;
      requestId: string;
      title: string;
      message: string;
      placeholder?: string;
      kind: "prompt" | "manual-code";
    }
  | {
      type: "auth-completed";
      providerId: string;
    }
  | {
      type: "auth-failed";
      providerId: string;
      message: string;
    };

export type TerminalEvent =
  | {
      type: "started";
      workspaceId: string;
    }
  | {
      type: "output";
      workspaceId: string;
      chunk: string;
    }
  | {
      type: "command-finished";
      workspaceId: string;
      commandId: string;
      command: string;
      exitCode: number;
      gitSnapshot?: GitSnapshot;
    }
  | {
      type: "error";
      workspaceId: string;
      message: string;
    }
  | {
      type: "exit";
      workspaceId: string;
      exitCode?: number;
    };
