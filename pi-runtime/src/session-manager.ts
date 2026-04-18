import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type {
  AgentSession,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import type { RuntimePaths, OllamaProbeResult } from "./bootstrap";
import { buildCatalog, fallbackProviderCatalogEntry } from "./bootstrap";
import { APPROVAL_TITLE } from "./approval-extension";
import type {
  ApprovalMode,
  ApprovalPolicyPayload,
  ProviderCatalogEntry,
  RuntimeCatalogPayload,
  RuntimeMetadata,
  RuntimeSessionInfo,
  WorkspacePolicyPayload,
} from "./protocol";

interface RuntimeSessionRecord {
  workspaceId: string;
  sessionId: string;
  cwd: string;
  sessionFile: string;
  session: AgentSession;
  activeProviderId: string;
  activeModelId: string;
  effort: string;
  assistantText: string;
  retryCount: number;
  lastUsage?: RuntimeMetadata["usage"];
  lastStopReason?: string;
  currentToolOutput: Map<string, string>;
  unsubscribe: () => void;
}

interface RuntimeUiBridge {
  emit(event: Record<string, unknown>): void;
  requestUi(args: {
    providerId?: string;
    workspaceId?: string;
    sessionId?: string;
    title: string;
    message: string;
    kind: "approval" | "prompt" | "manual-code";
    placeholder?: string;
    risk?: "low" | "medium" | "high";
    command?: string;
    path?: string;
  }): Promise<{
    requestId: string;
    confirmed?: boolean;
    value?: string;
    cancelled?: boolean;
  }>;
}

function sessionKey(workspaceId: string, sessionId: string) {
  return `${workspaceId}:${sessionId}`;
}

function thinkingLevelForEffort(effort?: string) {
  switch ((effort ?? "").trim()) {
    case "low":
      return "low" as const;
    case "medium":
      return "medium" as const;
    case "high":
    case "extra-high":
      return "high" as const;
    default:
      return "high" as const;
  }
}

function baseSettings(effort?: string) {
  return {
    defaultProvider: "openai-codex",
    defaultModel: "gpt-5.4",
    defaultThinkingLevel: thinkingLevelForEffort(effort),
    transport: "auto" as const,
    retry: {
      enabled: true,
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 60000,
    },
    steeringMode: "one-at-a-time" as const,
    followUpMode: "one-at-a-time" as const,
    extensions: ["extensions/picode-approval-gate.ts"],
  };
}

function stringifyToolPayload(payload: unknown) {
  if (payload == null) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function extractAssistantText(message: unknown) {
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = (message as { content?: unknown[] }).content ?? [];
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      const typed = part as { type?: string; text?: string };
      if (typed.type === "text" && typeof typed.text === "string") {
        return [typed.text];
      }
      return [];
    })
    .join("");
}

function summarizeTool(toolName: string, args: unknown) {
  const raw = stringifyToolPayload(args);
  if (!raw) {
    return toolName;
  }
  const compact = raw.replace(/\s+/g, " ").trim();
  const preview =
    compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
  return `${toolName} ${preview}`;
}

function metadataForRecord(record: RuntimeSessionRecord): RuntimeMetadata {
  return {
    providerId: record.activeProviderId,
    modelId: record.activeModelId,
    stopReason: record.lastStopReason,
    retryCount: record.retryCount,
    usage: record.lastUsage,
  };
}

export class PiSessionRuntimeManager {
  private readonly paths: RuntimePaths;
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistry;
  private readonly ui: RuntimeUiBridge;
  private readonly getOllamaProbe: () => OllamaProbeResult;
  private readonly sessions = new Map<string, RuntimeSessionRecord>();

  constructor(args: {
    paths: RuntimePaths;
    authStorage: AuthStorage;
    modelRegistry: ModelRegistry;
    ui: RuntimeUiBridge;
    getOllamaProbe: () => OllamaProbeResult;
  }) {
    this.paths = args.paths;
    this.authStorage = args.authStorage;
    this.modelRegistry = args.modelRegistry;
    this.ui = args.ui;
    this.getOllamaProbe = args.getOllamaProbe;
  }

  async updateWorkspacePolicy(payload: WorkspacePolicyPayload) {
    const raw = await Bun.file(this.paths.workspacePolicyPath)
      .json()
      .catch(() => ({
        workspaces: {},
      }));
    const next =
      raw && typeof raw === "object"
        ? structuredClone(raw)
        : { workspaces: {} };
    const workspaces =
      next &&
      typeof next === "object" &&
      "workspaces" in next &&
      next.workspaces &&
      typeof next.workspaces === "object"
        ? (next.workspaces as Record<string, unknown>)
        : {};
    workspaces[payload.workspaceId] = {
      workspaceId: payload.workspaceId,
      cwd: payload.cwd,
      approvalMode: payload.approvalMode,
      policy: payload.policy,
    };
    (next as { workspaces: Record<string, unknown> }).workspaces = workspaces;
    await Bun.write(
      this.paths.workspacePolicyPath,
      `${JSON.stringify(next, null, 2)}\n`,
    );
  }

  private resolveModelFromCatalog(
    requestedProviderId: string,
    requestedModelId: string,
  ) {
    const catalog = buildCatalog(
      this.authStorage,
      this.modelRegistry,
      this.getOllamaProbe(),
    );
    const requestedProvider = catalog.providers.find(
      (entry) => entry.id === requestedProviderId,
    );

    let selectedProvider: ProviderCatalogEntry | undefined = requestedProvider;
    if (!selectedProvider?.available) {
      selectedProvider =
        requestedProviderId === "openai-codex"
          ? fallbackProviderCatalogEntry(catalog)
          : undefined;
    }

    if (!selectedProvider) {
      return {
        catalog,
        providerId: requestedProviderId,
        modelId: requestedModelId,
        model: undefined,
        fallback: false,
      };
    }

    const selectedModelEntry =
      selectedProvider.models.find(
        (model) => model.id === requestedModelId && model.available,
      ) ?? selectedProvider.models.find((model) => model.available);

    const model = selectedModelEntry
      ? this.modelRegistry.find(selectedProvider.id, selectedModelEntry.id)
      : undefined;

    return {
      catalog,
      providerId: selectedProvider.id,
      modelId: selectedModelEntry?.id ?? requestedModelId,
      model,
      fallback:
        selectedProvider.id !== requestedProviderId ||
        (selectedModelEntry?.id ?? requestedModelId) !== requestedModelId,
    };
  }

  private async bindUi(record: RuntimeSessionRecord) {
    await record.session.bindExtensions({
      uiContext: {
        select: async (title, options) => {
          const response = await this.ui.requestUi({
            providerId: record.activeProviderId,
            workspaceId: record.workspaceId,
            sessionId: record.sessionId,
            title,
            message: options.join("\n"),
            kind: "prompt",
          });
          return response.value;
        },
        confirm: async (title, message) => {
          if (title === APPROVAL_TITLE) {
            let parsed: {
              title?: string;
              reason?: string;
              command?: string;
              path?: string;
              risk?: "low" | "medium" | "high";
            } = {};
            try {
              parsed = JSON.parse(message) as typeof parsed;
            } catch {
              parsed = {
                title: "Approve action",
                reason: message,
                risk: "medium",
              };
            }
            const response = await this.ui.requestUi({
              workspaceId: record.workspaceId,
              sessionId: record.sessionId,
              title: parsed.title ?? "Approve action",
              message: parsed.reason ?? message,
              kind: "approval",
              risk: parsed.risk ?? "medium",
              command: parsed.command,
              path: parsed.path,
            });
            this.ui.emit({
              type: "approval_resolved",
              workspaceId: record.workspaceId,
              sessionId: record.sessionId,
              approvalId: response.requestId,
              decision: response.confirmed ? "approved" : "rejected",
              summary: response.confirmed
                ? "User approved the requested action."
                : "User rejected the requested action.",
            });
            return Boolean(response.confirmed);
          }

          const response = await this.ui.requestUi({
            providerId: record.activeProviderId,
            workspaceId: record.workspaceId,
            sessionId: record.sessionId,
            title,
            message,
            kind: "approval",
            risk: "medium",
          });
          return Boolean(response.confirmed);
        },
        input: async (title, placeholder) => {
          const response = await this.ui.requestUi({
            providerId: record.activeProviderId,
            workspaceId: record.workspaceId,
            sessionId: record.sessionId,
            title,
            message: title,
            placeholder,
            kind: "prompt",
          });
          return response.value;
        },
        notify: (message, type) => {
          this.ui.emit({
            type: "status",
            workspaceId: record.workspaceId,
            sessionId: record.sessionId,
            label: type === "error" ? "Extension error" : "Extension",
            detail: message,
          });
        },
        onTerminalInput: () => () => undefined,
        setStatus: (_key, text) => {
          if (text) {
            this.ui.emit({
              type: "status",
              workspaceId: record.workspaceId,
              sessionId: record.sessionId,
              label: "Extension",
              detail: text,
            });
          }
        },
        setWorkingMessage: () => undefined,
        setHiddenThinkingLabel: () => undefined,
        setWidget: () => undefined,
        setFooter: () => undefined,
        setHeader: () => undefined,
        setTitle: () => undefined,
        custom: async () => undefined as never,
        pasteToEditor: () => undefined,
        setEditorText: () => undefined,
        getEditorText: () => "",
        editor: async (_title, prefill) => prefill,
        setEditorComponent: () => undefined,
        theme: {} as never,
        getAllThemes: () => [],
        getTheme: () => undefined,
        setTheme: () => ({
          success: false,
          error: "Theme changes are not supported in picode.",
        }),
        getToolsExpanded: () => false,
        setToolsExpanded: () => undefined,
      },
    });
  }

  private subscribe(record: RuntimeSessionRecord) {
    return record.session.subscribe((event) => {
      const workspaceId = record.workspaceId;
      const sessionId = record.sessionId;
      const typed = event as Record<string, unknown>;

      switch (event.type) {
        case "agent_start":
          record.assistantText = "";
          record.retryCount = 0;
          record.lastUsage = undefined;
          record.lastStopReason = undefined;
          this.ui.emit({
            type: "status",
            workspaceId,
            sessionId,
            label: "Running",
            detail: "Pi started processing your prompt.",
          });
          break;
        case "turn_start":
          this.ui.emit({
            type: "status",
            workspaceId,
            sessionId,
            label: "Thinking",
            detail: "Pi is working on the next turn.",
          });
          break;
        case "message_update": {
          const assistantMessageEvent = typed.assistantMessageEvent as
            | {
                type?: string;
                delta?: string;
                partial?: {
                  provider?: string;
                  model?: string;
                  usage?: RuntimeMetadata["usage"];
                };
              }
            | undefined;
          if (!assistantMessageEvent) {
            break;
          }
          if (
            assistantMessageEvent.partial?.provider &&
            assistantMessageEvent.partial?.model
          ) {
            record.activeProviderId = assistantMessageEvent.partial.provider;
            record.activeModelId = assistantMessageEvent.partial.model;
          }
          if (assistantMessageEvent.partial?.usage) {
            record.lastUsage = assistantMessageEvent.partial.usage;
          }
          if (
            assistantMessageEvent.type === "text_delta" &&
            typeof assistantMessageEvent.delta === "string"
          ) {
            record.assistantText += assistantMessageEvent.delta;
            this.ui.emit({
              type: "token",
              workspaceId,
              sessionId,
              delta: assistantMessageEvent.delta,
              metadata: metadataForRecord(record),
            });
          }
          break;
        }
        case "message_end": {
          const message = typed.message as
            | {
                role?: string;
                provider?: string;
                model?: string;
                usage?: RuntimeMetadata["usage"];
                stopReason?: string;
              }
            | undefined;
          if (message?.role === "assistant") {
            if (message.provider) {
              record.activeProviderId = message.provider;
            }
            if (message.model) {
              record.activeModelId = message.model;
            }
            if (message.usage) {
              record.lastUsage = message.usage;
            }
            if (message.stopReason) {
              record.lastStopReason = message.stopReason;
            }
            const extracted = extractAssistantText(message);
            if (extracted && !record.assistantText) {
              record.assistantText = extracted;
            }
          }
          break;
        }
        case "tool_execution_start": {
          const toolCallId = String(typed.toolCallId ?? crypto.randomUUID());
          const toolName = String(typed.toolName ?? "tool");
          const args = typed.args;
          record.currentToolOutput.set(toolCallId, "");
          this.ui.emit({
            type: "tool_start",
            workspaceId,
            sessionId,
            activity: {
              id: toolCallId,
              toolName,
              summary: summarizeTool(toolName, args),
              output: "",
              status: "running",
              startedAt: new Date().toISOString(),
            },
          });
          break;
        }
        case "tool_execution_update": {
          const toolCallId = String(typed.toolCallId ?? "");
          const partial = stringifyToolPayload(typed.partialResult);
          record.currentToolOutput.set(toolCallId, partial);
          this.ui.emit({
            type: "tool_update",
            workspaceId,
            sessionId,
            activityId: toolCallId,
            output: partial,
            status: "running",
          });
          break;
        }
        case "tool_execution_end": {
          const toolCallId = String(typed.toolCallId ?? "");
          const output =
            stringifyToolPayload(typed.result) ||
            record.currentToolOutput.get(toolCallId) ||
            "";
          record.currentToolOutput.set(toolCallId, output);
          this.ui.emit({
            type: "tool_end",
            workspaceId,
            sessionId,
            activityId: toolCallId,
            output,
            status: typed.isError ? "failed" : "completed",
          });
          break;
        }
        case "auto_retry_start":
          record.retryCount = Number(typed.attempt ?? 1);
          this.ui.emit({
            type: "status",
            workspaceId,
            sessionId,
            label: `Retry ${typed.attempt}/${typed.maxAttempts}`,
            detail: String(
              typed.errorMessage ?? "Retrying after a transient failure.",
            ),
          });
          break;
        case "auto_retry_end":
          if (typed.success === false) {
            this.ui.emit({
              type: "status",
              workspaceId,
              sessionId,
              label: "Retry failed",
              detail: String(
                typed.finalError ?? "The retry did not recover the request.",
              ),
            });
          }
          break;
        case "agent_end":
          if (typed.errorMessage) {
            this.ui.emit({
              type: "error",
              workspaceId,
              sessionId,
              message: String(typed.errorMessage),
              metadata: metadataForRecord(record),
            });
          } else {
            this.ui.emit({
              type: "done",
              workspaceId,
              sessionId,
              content: record.assistantText,
              metadata: metadataForRecord(record),
            });
          }
          break;
      }
    });
  }

  async createOrResumeSession(args: {
    workspaceId: string;
    sessionId: string;
    cwd: string;
    providerId: string;
    modelId: string;
    effort?: string;
    approvalMode: ApprovalMode;
    policy: ApprovalPolicyPayload;
  }): Promise<RuntimeSessionInfo> {
    await this.updateWorkspacePolicy({
      workspaceId: args.workspaceId,
      cwd: args.cwd,
      approvalMode: args.approvalMode,
      policy: args.policy,
    });

    const key = sessionKey(args.workspaceId, args.sessionId);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.effort = args.effort ?? existing.effort;
      return {
        providerId: existing.activeProviderId,
        modelId: existing.activeModelId,
        piSessionFile: existing.sessionFile,
        lastKnownReady: true,
      };
    }

    const resolved = this.resolveModelFromCatalog(
      args.providerId,
      args.modelId,
    );
    if (!resolved.model) {
      throw new Error(
        "No ready provider is available. Complete provider setup first.",
      );
    }

    const workspaceSessionDir = path.join(
      this.paths.sessionsRoot,
      args.workspaceId,
    );
    await mkdir(workspaceSessionDir, { recursive: true });
    await Bun.write(path.join(workspaceSessionDir, ".keep"), "");
    const sessionFile = path.join(
      workspaceSessionDir,
      `${args.sessionId}.jsonl`,
    );
    const sessionManager = SessionManager.open(
      sessionFile,
      workspaceSessionDir,
      args.cwd,
    );
    const settingsManager = SettingsManager.inMemory(baseSettings(args.effort));
    const resourceLoader = new DefaultResourceLoader({
      cwd: args.cwd,
      agentDir: this.paths.piHome,
      settingsManager,
      additionalExtensionPaths: [this.paths.approvalExtensionPath],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: args.cwd,
      agentDir: this.paths.piHome,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      model: resolved.model,
      thinkingLevel: thinkingLevelForEffort(args.effort),
      sessionManager,
      settingsManager,
      resourceLoader,
    });
    session.setSteeringMode("one-at-a-time");
    session.setFollowUpMode("one-at-a-time");
    session.setAutoRetryEnabled(true);

    const record: RuntimeSessionRecord = {
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
      cwd: args.cwd,
      sessionFile,
      session,
      activeProviderId: resolved.providerId,
      activeModelId: resolved.modelId,
      effort: args.effort ?? "high",
      assistantText: "",
      retryCount: 0,
      currentToolOutput: new Map(),
      unsubscribe: () => undefined,
    };
    await this.bindUi(record);
    record.unsubscribe = this.subscribe(record);
    this.sessions.set(key, record);

    if (resolved.fallback) {
      this.ui.emit({
        type: "status",
        workspaceId: args.workspaceId,
        sessionId: args.sessionId,
        label: "Provider fallback",
        detail: `Switched to ${resolved.providerId}/${resolved.modelId} because ${args.providerId}/${args.modelId} is not ready.`,
      });
    }

    return {
      providerId: resolved.providerId,
      modelId: resolved.modelId,
      piSessionFile: sessionFile,
      lastKnownReady: true,
    };
  }

  async setProviderModel(args: {
    workspaceId: string;
    sessionId: string;
    providerId: string;
    modelId: string;
    effort?: string;
  }) {
    const record = this.sessions.get(
      sessionKey(args.workspaceId, args.sessionId),
    );
    if (!record) {
      throw new Error("Session is not initialized.");
    }
    const resolved = this.resolveModelFromCatalog(
      args.providerId,
      args.modelId,
    );
    if (!resolved.model) {
      throw new Error("The selected provider is not ready.");
    }
    await record.session.setModel(resolved.model as Model<any>);
    record.session.setThinkingLevel(thinkingLevelForEffort(args.effort));
    record.activeProviderId = resolved.providerId;
    record.activeModelId = resolved.modelId;
    record.effort = args.effort ?? record.effort;
    return {
      providerId: record.activeProviderId,
      modelId: record.activeModelId,
      piSessionFile: record.sessionFile,
      lastKnownReady: true,
    } satisfies RuntimeSessionInfo;
  }

  async prompt(args: {
    workspaceId: string;
    sessionId: string;
    prompt: string;
    providerId: string;
    modelId: string;
    effort?: string;
  }) {
    const record = this.sessions.get(
      sessionKey(args.workspaceId, args.sessionId),
    );
    if (!record) {
      throw new Error("Session is not initialized.");
    }
    if (record.session.isStreaming) {
      throw new Error("A prompt is already running for this session.");
    }

    const resolved = this.resolveModelFromCatalog(
      args.providerId,
      args.modelId,
    );
    if (!resolved.model) {
      throw new Error("The selected provider is not ready.");
    }
    await record.session.setModel(resolved.model as Model<any>);
    record.session.setThinkingLevel(thinkingLevelForEffort(args.effort));
    record.activeProviderId = resolved.providerId;
    record.activeModelId = resolved.modelId;
    record.effort = args.effort ?? record.effort;
    record.assistantText = "";
    record.retryCount = 0;
    record.lastUsage = undefined;
    record.lastStopReason = undefined;
    record.currentToolOutput.clear();

    void record.session
      .prompt(args.prompt, { source: "rpc" })
      .catch((error) => {
        this.ui.emit({
          type: "error",
          workspaceId: record.workspaceId,
          sessionId: record.sessionId,
          message: error instanceof Error ? error.message : String(error),
          metadata: metadataForRecord(record),
        });
      });
  }

  async abort(args: { workspaceId: string; sessionId: string }) {
    const record = this.sessions.get(
      sessionKey(args.workspaceId, args.sessionId),
    );
    if (!record) {
      return false;
    }
    if (!record.session.isStreaming) {
      return false;
    }
    await record.session.abort();
    this.ui.emit({
      type: "status",
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
      label: "Aborted",
      detail: "The active Pi run was cancelled.",
    });
    return true;
  }

  dispose() {
    for (const record of this.sessions.values()) {
      record.unsubscribe();
      record.session.dispose();
    }
    this.sessions.clear();
  }
}
