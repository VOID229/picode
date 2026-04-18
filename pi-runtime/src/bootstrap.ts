import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AuthStorage,
  ModelRegistry,
  SettingsManager,
  VERSION,
} from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { approvalExtensionSource } from "./approval-extension";
import type {
  ModelCatalogEntry,
  ProviderAuthKind,
  ProviderCatalogEntry,
  RuntimeCatalogPayload,
} from "./protocol";

const SUPPORTED_PROVIDER_IDS = [
  "openai-codex",
  "anthropic",
  "opencode",
  "opencode-go",
  "ollama",
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  "openai-codex": "Codex",
  anthropic: "Claude",
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
  ollama: "Ollama",
};

export interface RuntimePaths {
  appDataDir: string;
  piHome: string;
  authPath: string;
  settingsPath: string;
  modelsPath: string;
  extensionsDir: string;
  approvalExtensionPath: string;
  workspacePolicyPath: string;
  sessionsRoot: string;
}

export interface OllamaProbeResult {
  reachable: boolean;
  modelIds: string[];
  error?: string;
}

export function resolveRuntimePaths(appDataDir: string): RuntimePaths {
  const piHome = path.join(appDataDir, "pi-home");
  return {
    appDataDir,
    piHome,
    authPath: path.join(piHome, "auth.json"),
    settingsPath: path.join(piHome, "settings.json"),
    modelsPath: path.join(piHome, "models.json"),
    extensionsDir: path.join(piHome, "extensions"),
    approvalExtensionPath: path.join(
      piHome,
      "extensions",
      "picode-approval-gate.ts",
    ),
    workspacePolicyPath: path.join(piHome, "workspace-policies.json"),
    sessionsRoot: path.join(piHome, "sessions"),
  };
}

function defaultSettings() {
  return {
    defaultProvider: "openai-codex",
    defaultModel: "gpt-5.4",
    defaultThinkingLevel: "high",
    transport: "auto",
    retry: {
      enabled: true,
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 60000,
    },
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    extensions: ["extensions/picode-approval-gate.ts"],
    sessionDir: "sessions",
  };
}

export async function ensureRuntimeHome(paths: RuntimePaths) {
  await mkdir(paths.piHome, { recursive: true });
  await mkdir(paths.extensionsDir, { recursive: true });
  await mkdir(paths.sessionsRoot, { recursive: true });

  const settingsManager = SettingsManager.create(undefined, paths.piHome);
  settingsManager.setDefaultModelAndProvider("openai-codex", "gpt-5.4");
  settingsManager.setDefaultThinkingLevel("high");
  settingsManager.setTransport("auto");
  settingsManager.setRetryEnabled(true);
  settingsManager.setSteeringMode("one-at-a-time");
  settingsManager.setFollowUpMode("one-at-a-time");
  settingsManager.setExtensionPaths(["extensions/picode-approval-gate.ts"]);
  await settingsManager.flush();

  const settings = {
    ...defaultSettings(),
    ...settingsManager.getGlobalSettings(),
  };
  await writeFile(paths.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  await writeFile(
    paths.approvalExtensionPath,
    approvalExtensionSource(paths.workspacePolicyPath),
  );

  try {
    await readFile(paths.workspacePolicyPath, "utf8");
  } catch {
    await writeFile(
      paths.workspacePolicyPath,
      `${JSON.stringify({ workspaces: {} }, null, 2)}\n`,
    );
  }

  const authStorage = AuthStorage.create(paths.authPath);
  return {
    settingsManager,
    authStorage,
    modelRegistry: ModelRegistry.create(authStorage, paths.modelsPath),
  };
}

function formatContextWindow(contextWindow: number | undefined) {
  if (!contextWindow || Number.isNaN(contextWindow)) {
    return "unknown";
  }

  if (contextWindow >= 1000) {
    const rounded = contextWindow / 1000;
    return Number.isInteger(rounded) ? `${rounded}k` : `${rounded.toFixed(1)}k`;
  }

  return `${contextWindow}`;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeModelsJson(paths: RuntimePaths, probe: OllamaProbeResult) {
  const current = await readJsonFile<Record<string, unknown>>(
    paths.modelsPath,
    {
      providers: {},
    },
  );
  const next =
    current && typeof current === "object"
      ? structuredClone(current)
      : { providers: {} };
  const providers =
    next &&
    typeof next === "object" &&
    "providers" in next &&
    next.providers &&
    typeof next.providers === "object"
      ? (next.providers as Record<string, unknown>)
      : {};

  if (probe.reachable) {
    providers.ollama = {
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      apiKey: "ollama",
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
      models: probe.modelIds.map((id) => ({ id })),
    };
  } else {
    delete providers.ollama;
  }

  (next as { providers: Record<string, unknown> }).providers = providers;
  await writeFile(paths.modelsPath, `${JSON.stringify(next, null, 2)}\n`);
}

async function fetchOllamaTags() {
  const response = await fetch("http://127.0.0.1:11434/api/tags", {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    models?: Array<{ name?: string; model?: string }>;
  };
  return (payload.models ?? [])
    .map((entry) => entry.name ?? entry.model)
    .filter((value): value is string => Boolean(value));
}

async function fetchOllamaV1Models() {
  const response = await fetch("http://127.0.0.1:11434/v1/models", {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };
  return (payload.data ?? [])
    .map((entry) => entry.id)
    .filter((value): value is string => Boolean(value));
}

export async function probeOllama(
  paths: RuntimePaths,
): Promise<OllamaProbeResult> {
  try {
    const modelIds = Array.from(
      new Set([...(await fetchOllamaTags()), ...(await fetchOllamaV1Models())]),
    );
    const result = {
      reachable: true,
      modelIds,
    } satisfies OllamaProbeResult;
    await writeModelsJson(paths, result);
    return result;
  } catch (error) {
    const result = {
      reachable: false,
      modelIds: [],
      error: error instanceof Error ? error.message : String(error),
    } satisfies OllamaProbeResult;
    await writeModelsJson(paths, result);
    return result;
  }
}

function providerAuthKind(
  providerId: string,
  oauthIds: Set<string>,
): ProviderAuthKind {
  if (providerId === "ollama") {
    return "local";
  }
  if (oauthIds.has(providerId)) {
    return "oauth";
  }
  return "api-key";
}

function providerReason(
  status: ProviderCatalogEntry["status"],
  providerId: string,
  ollama?: OllamaProbeResult,
) {
  switch (status) {
    case "ready":
      return undefined;
    case "requires_oauth":
      return `${PROVIDER_LABELS[providerId] ?? providerId} login is required.`;
    case "requires_api_key":
      return `${PROVIDER_LABELS[providerId] ?? providerId} API key is required.`;
    case "requires_local_runtime":
      return ollama?.error
        ? `Ollama is not reachable: ${ollama.error}`
        : "Start Ollama locally to enable this provider.";
    case "unavailable":
      return "No models are currently available.";
    case "error":
      return "Provider configuration failed to load.";
  }
}

function mapModels(
  providerId: string,
  models: Model<any>[],
  availableIds: Set<string>,
): ModelCatalogEntry[] {
  return models.map((model) => ({
    id: model.id,
    label: model.name,
    providerId,
    contextWindow: formatContextWindow(model.contextWindow),
    available: availableIds.has(model.id),
    providerSource: providerId === "ollama" ? "custom" : "built-in",
  }));
}

export function buildCatalog(
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  ollama: OllamaProbeResult,
): RuntimeCatalogPayload {
  modelRegistry.refresh();
  authStorage.reload();
  const oauthIds = new Set(
    authStorage.getOAuthProviders().map((provider) => provider.id),
  );
  const allModels = modelRegistry.getAll();
  const availableModels = modelRegistry.getAvailable();

  const providers = SUPPORTED_PROVIDER_IDS.map(
    (providerId): ProviderCatalogEntry => {
      const providerModels = allModels.filter(
        (model) => model.provider === providerId,
      );
      const availableProviderModels = availableModels.filter(
        (model) => model.provider === providerId,
      );
      const availableIds = new Set(
        availableProviderModels.map((model) => model.id),
      );
      const authKind = providerAuthKind(providerId, oauthIds);

      let status: ProviderCatalogEntry["status"];
      if (providerId === "ollama" && !ollama.reachable) {
        status = "requires_local_runtime";
      } else if (availableProviderModels.length > 0) {
        status = "ready";
      } else if (authKind === "oauth") {
        status = "requires_oauth";
      } else if (authKind === "api-key") {
        status = "requires_api_key";
      } else {
        status = "unavailable";
      }

      return {
        id: providerId,
        label: PROVIDER_LABELS[providerId] ?? providerId,
        status,
        authKind,
        available: status === "ready",
        reason: providerReason(status, providerId, ollama),
        models: mapModels(providerId, providerModels, availableIds),
      };
    },
  );

  return { providers };
}

export function fallbackProviderCatalogEntry(catalog: RuntimeCatalogPayload) {
  const order = ["openai-codex", "anthropic", "opencode", "ollama"];
  for (const providerId of order) {
    const provider = catalog.providers.find((entry) => entry.id === providerId);
    if (provider?.available) {
      return provider;
    }
  }
  return catalog.providers.find((provider) => provider.available);
}

export async function resetRuntimeHome(paths: RuntimePaths) {
  await rm(paths.piHome, { recursive: true, force: true });
}

export { VERSION };
