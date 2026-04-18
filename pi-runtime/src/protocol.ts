export type ProviderStatus =
  | "ready"
  | "requires_oauth"
  | "requires_api_key"
  | "requires_local_runtime"
  | "unavailable"
  | "error";

export type ProviderAuthKind = "oauth" | "api-key" | "local";

export interface ModelCatalogEntry {
  id: string;
  label: string;
  providerId: string;
  contextWindow: string;
  available: boolean;
  providerSource: "built-in" | "custom";
}

export interface ProviderCatalogEntry {
  id: string;
  label: string;
  status: ProviderStatus;
  authKind: ProviderAuthKind;
  available: boolean;
  reason?: string;
  models: ModelCatalogEntry[];
}

export interface RuntimeCatalogPayload {
  providers: ProviderCatalogEntry[];
}

export interface RuntimeUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

export interface RuntimeMetadata {
  providerId?: string;
  modelId?: string;
  stopReason?: string;
  retryCount?: number;
  usage?: RuntimeUsage;
}

export interface RuntimeSessionInfo {
  providerId: string;
  modelId: string;
  piSessionFile: string;
  lastKnownReady: boolean;
  lastError?: string;
}

export interface ApprovalPolicyPayload {
  allowedPaths: string[];
  allowedCommands: string[];
  envPassthrough: string[];
  networkEnabled: boolean;
}

export type ApprovalMode = "supervised" | "auto-accept-edits" | "full-access";

export interface WorkspacePolicyPayload {
  workspaceId: string;
  cwd: string;
  approvalMode: ApprovalMode;
  policy: ApprovalPolicyPayload;
}

export interface RuntimeCommandMap {
  bootstrap: {
    appDataDir: string;
  };
  refresh_catalog: Record<string, never>;
  create_or_resume_session: {
    workspaceId: string;
    sessionId: string;
    cwd: string;
    providerId: string;
    modelId: string;
    effort?: string;
    approvalMode: ApprovalMode;
    policy: ApprovalPolicyPayload;
  };
  prompt: {
    workspaceId: string;
    sessionId: string;
    prompt: string;
    providerId: string;
    modelId: string;
    effort?: string;
  };
  abort: {
    workspaceId: string;
    sessionId: string;
  };
  set_provider_model: {
    workspaceId: string;
    sessionId: string;
    providerId: string;
    modelId: string;
    effort?: string;
  };
  set_workspace_policy: WorkspacePolicyPayload;
  login_oauth: {
    providerId: string;
  };
  logout_provider: {
    providerId: string;
  };
  save_api_key: {
    providerId: string;
    apiKey: string;
  };
  delete_api_key: {
    providerId: string;
  };
  respond_ui_request: {
    requestId: string;
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  };
  healthcheck: Record<string, never>;
}

export type RuntimeCommandName = keyof RuntimeCommandMap;

export type RuntimeCommand = {
  [K in RuntimeCommandName]: {
    id: string;
    command: K;
    payload: RuntimeCommandMap[K];
  };
}[RuntimeCommandName];

export type RuntimeEvent =
  | { type: "runtime_ready"; piHome: string; version?: string }
  | ({ type: "catalog" } & RuntimeCatalogPayload)
  | {
      type: "status";
      workspaceId?: string;
      sessionId?: string;
      label: string;
      detail?: string;
    }
  | {
      type: "token";
      workspaceId: string;
      sessionId: string;
      delta: string;
      metadata?: RuntimeMetadata;
    }
  | {
      type: "tool_start";
      workspaceId: string;
      sessionId: string;
      activity: {
        id: string;
        toolName: string;
        summary: string;
        output?: string;
        status: "running" | "completed" | "failed";
        startedAt: string;
      };
    }
  | {
      type: "tool_update";
      workspaceId: string;
      sessionId: string;
      activityId: string;
      output: string;
      status: "running" | "completed" | "failed";
    }
  | {
      type: "tool_end";
      workspaceId: string;
      sessionId: string;
      activityId: string;
      output: string;
      status: "running" | "completed" | "failed";
    }
  | {
      type: "approval_requested";
      workspaceId: string;
      sessionId: string;
      approval: {
        id: string;
        title: string;
        reason: string;
        command?: string;
        path?: string;
        diffPreview?: string;
        risk: "low" | "medium" | "high";
        status: "pending" | "approved" | "rejected";
        requestedAt: string;
      };
    }
  | {
      type: "approval_resolved";
      workspaceId: string;
      sessionId: string;
      approvalId: string;
      decision: "approved" | "rejected";
      summary: string;
    }
  | {
      type: "done";
      workspaceId: string;
      sessionId: string;
      content: string;
      metadata?: RuntimeMetadata;
    }
  | {
      type: "error";
      workspaceId?: string;
      sessionId?: string;
      message: string;
      metadata?: RuntimeMetadata;
    }
  | {
      type: "auth_browser_open";
      providerId: string;
      url: string;
      instructions?: string;
    }
  | {
      type: "auth_manual_input_requested";
      providerId: string;
      requestId: string;
      title: string;
      message: string;
      placeholder?: string;
      kind: "prompt" | "manual-code";
    }
  | {
      type: "auth_completed";
      providerId: string;
    }
  | {
      type: "auth_failed";
      providerId: string;
      message: string;
    };

export interface RuntimeResponse {
  type: "response";
  requestId: string;
  success: boolean;
  payload?: unknown;
  error?: string;
}

export interface RuntimeEventEnvelope {
  type: "event";
  event: RuntimeEvent;
}

export type RuntimeEnvelope = RuntimeResponse | RuntimeEventEnvelope;

export function writeEnvelope(envelope: RuntimeEnvelope) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

export function writeEvent(event: RuntimeEvent) {
  writeEnvelope({ type: "event", event });
}

export function writeResponse(
  requestId: string,
  success: boolean,
  payload?: unknown,
  error?: string,
) {
  writeEnvelope({ type: "response", requestId, success, payload, error });
}
