import { createInterface } from "node:readline";
import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { VERSION } from "./bootstrap";
import {
  buildCatalog,
  ensureRuntimeHome,
  probeOllama,
  resolveRuntimePaths,
  type OllamaProbeResult,
  type RuntimePaths,
} from "./bootstrap";
import {
  deleteProviderApiKey,
  loginOAuthProvider,
  saveProviderApiKey,
} from "./auth";
import { PiSessionRuntimeManager } from "./session-manager";
import type { RuntimeCommand } from "./protocol";
import { writeEvent, writeResponse } from "./protocol";

type PendingUiRequestResolver = (value: {
  requestId: string;
  confirmed?: boolean;
  value?: string;
  cancelled?: boolean;
}) => void;

class PiRuntimeServer {
  private paths?: RuntimePaths;
  private authStorage?: AuthStorage;
  private modelRegistry?: ModelRegistry;
  private runtime?: PiSessionRuntimeManager;
  private ollamaProbe: OllamaProbeResult = {
    reachable: false,
    modelIds: [],
  };
  private readonly pendingUiRequests = new Map<
    string,
    PendingUiRequestResolver
  >();

  private requireRuntime() {
    if (
      !this.paths ||
      !this.authStorage ||
      !this.modelRegistry ||
      !this.runtime
    ) {
      throw new Error("Runtime is not bootstrapped.");
    }
    return {
      paths: this.paths,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      runtime: this.runtime,
    };
  }

  private async refreshCatalog() {
    const { paths, authStorage, modelRegistry } = this.requireRuntime();
    this.ollamaProbe = await probeOllama(paths);
    const catalog = buildCatalog(authStorage, modelRegistry, this.ollamaProbe);
    writeEvent({ type: "catalog", ...catalog });
    return catalog;
  }

  private async requestUi(args: {
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
  }) {
    const requestId = crypto.randomUUID();
    const promise = new Promise<{
      requestId: string;
      confirmed?: boolean;
      value?: string;
      cancelled?: boolean;
    }>((resolve) => {
      this.pendingUiRequests.set(requestId, resolve);
    });

    if (args.kind === "approval") {
      writeEvent({
        type: "approval_requested",
        workspaceId: args.workspaceId ?? "",
        sessionId: args.sessionId ?? "",
        approval: {
          id: requestId,
          title: args.title,
          reason: args.message,
          command: args.command,
          path: args.path,
          risk: args.risk ?? "medium",
          status: "pending",
          requestedAt: new Date().toISOString(),
        },
      });
    } else {
      writeEvent({
        type: "auth_manual_input_requested",
        providerId: args.providerId ?? "provider",
        requestId,
        title: args.title,
        message: args.message,
        placeholder: args.placeholder,
        kind: args.kind === "manual-code" ? "manual-code" : "prompt",
      });
    }

    return promise;
  }

  async handle(command: RuntimeCommand) {
    try {
      switch (command.command) {
        case "bootstrap": {
          this.paths = resolveRuntimePaths(command.payload.appDataDir);
          const { settingsManager, authStorage, modelRegistry } =
            await ensureRuntimeHome(this.paths);
          void settingsManager;
          this.authStorage = authStorage;
          this.modelRegistry = modelRegistry;
          this.ollamaProbe = await probeOllama(this.paths);
          this.runtime?.dispose();
          this.runtime = new PiSessionRuntimeManager({
            paths: this.paths,
            authStorage: this.authStorage,
            modelRegistry: this.modelRegistry,
            ui: {
              emit: (event) => writeEvent(event as never),
              requestUi: (args) => this.requestUi(args),
            },
            getOllamaProbe: () => this.ollamaProbe,
          });
          const catalog = buildCatalog(
            this.authStorage,
            this.modelRegistry,
            this.ollamaProbe,
          );
          writeEvent({
            type: "runtime_ready",
            piHome: this.paths.piHome,
            version: VERSION,
          });
          writeEvent({ type: "catalog", ...catalog });
          writeResponse(command.id, true, {
            piHome: this.paths.piHome,
            version: VERSION,
            catalog,
          });
          break;
        }
        case "refresh_catalog": {
          const catalog = await this.refreshCatalog();
          writeResponse(command.id, true, catalog);
          break;
        }
        case "create_or_resume_session": {
          const { runtime } = this.requireRuntime();
          const info = await runtime.createOrResumeSession(command.payload);
          writeResponse(command.id, true, info);
          break;
        }
        case "prompt": {
          const { runtime } = this.requireRuntime();
          await runtime.prompt(command.payload);
          writeResponse(command.id, true);
          break;
        }
        case "abort": {
          const { runtime } = this.requireRuntime();
          const aborted = await runtime.abort(command.payload);
          writeResponse(command.id, true, { aborted });
          break;
        }
        case "set_provider_model": {
          const { runtime } = this.requireRuntime();
          const info = await runtime.setProviderModel(command.payload);
          writeResponse(command.id, true, info);
          break;
        }
        case "set_workspace_policy": {
          const { runtime } = this.requireRuntime();
          await runtime.updateWorkspacePolicy(command.payload);
          writeResponse(command.id, true);
          break;
        }
        case "login_oauth": {
          const { authStorage, modelRegistry } = this.requireRuntime();
          const catalog = await loginOAuthProvider({
            providerId: command.payload.providerId,
            authStorage,
            modelRegistry,
            bridge: {
              emitEvent: (event: {
                type:
                  | "status"
                  | "auth_browser_open"
                  | "auth_manual_input_requested"
                  | "auth_completed"
                  | "auth_failed";
                [key: string]: unknown;
              }) => writeEvent(event as never),
              emitCatalog: (catalog) =>
                writeEvent({ type: "catalog", ...catalog }),
              requestInput: async (args) => {
                const response = await this.requestUi({
                  providerId: args.providerId,
                  title: args.title,
                  message: args.message,
                  placeholder: args.placeholder,
                  kind: args.kind,
                });
                if (response.cancelled) {
                  throw new Error("User cancelled the login flow.");
                }
                return response.value ?? "";
              },
            },
            refreshCatalog: async () => this.refreshCatalog(),
          });
          writeResponse(command.id, true, catalog);
          break;
        }
        case "logout_provider": {
          const { authStorage } = this.requireRuntime();
          authStorage.logout(command.payload.providerId);
          const catalog = await this.refreshCatalog();
          writeResponse(command.id, true, catalog);
          break;
        }
        case "save_api_key": {
          const { authStorage } = this.requireRuntime();
          saveProviderApiKey({
            providerId: command.payload.providerId,
            apiKey: command.payload.apiKey,
            authStorage,
          });
          const catalog = await this.refreshCatalog();
          writeResponse(command.id, true, catalog);
          break;
        }
        case "delete_api_key": {
          const { authStorage } = this.requireRuntime();
          deleteProviderApiKey({
            providerId: command.payload.providerId,
            authStorage,
          });
          const catalog = await this.refreshCatalog();
          writeResponse(command.id, true, catalog);
          break;
        }
        case "respond_ui_request": {
          const resolver = this.pendingUiRequests.get(
            command.payload.requestId,
          );
          if (!resolver) {
            throw new Error("Unknown UI request.");
          }
          this.pendingUiRequests.delete(command.payload.requestId);
          resolver({
            requestId: command.payload.requestId,
            confirmed: command.payload.confirmed,
            value: command.payload.value,
            cancelled: command.payload.cancelled,
          });
          writeResponse(command.id, true);
          break;
        }
        case "healthcheck": {
          const ready = Boolean(this.runtime && this.paths);
          writeResponse(command.id, true, {
            ready,
            version: VERSION,
            piHome: this.paths?.piHome,
          });
          break;
        }
      }
    } catch (error) {
      writeResponse(
        command.id,
        false,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

const server = new PiRuntimeServer();
const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });

reader.on("line", (line) => {
  if (!line.trim()) {
    return;
  }

  try {
    const command = JSON.parse(line) as RuntimeCommand;
    void server.handle(command);
  } catch (error) {
    writeEvent({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
