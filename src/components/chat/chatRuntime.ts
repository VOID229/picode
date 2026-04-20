import type {
  ChatSession,
  ProviderOption,
  TimelineItem,
  WorkspaceRecord,
} from "../../domains/types";

export interface AssistantContentBlock {
  type: "markdown" | "proposed-plan";
  content: string;
}

export interface LivePhase {
  phase:
    | "reading-files"
    | "listing-directory"
    | "writing-files"
    | "verifying"
    | "thinking";
  label: string;
  detail?: string;
}

export interface ComposerEffortOption {
  id: string;
  label: string;
}

export interface ComposerCapabilities {
  effortOptions: ComposerEffortOption[];
  supportsFastMode: boolean;
  normalizedEffort: string;
  normalizedFastMode: boolean;
}

const PLAN_BLOCK_PATTERN = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/gi;
const PRESENTATION_QUALIFIER_PATTERN = /\s+(medium|high|low|fast)$/i;
const CODEX_PATTERN = /\bcodex\b/i;
const DEFAULT_EFFORT = "high";
const DEFAULT_EFFORT_OPTIONS: ComposerEffortOption[] = [
  { id: "high", label: "High (default)" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];
const CODEX_EFFORT_OPTIONS: ComposerEffortOption[] = [
  { id: "extra-high", label: "Extra High" },
  ...DEFAULT_EFFORT_OPTIONS,
];

const TRANSIENT_STATUS_MATCHERS: Array<{
  phase: LivePhase["phase"];
  patterns: RegExp[];
}> = [
  {
    phase: "reading-files",
    patterns: [
      /\bread(ing)?\b/,
      /\bopen(ing)?\b/,
      /\binspect(ing)?\b/,
      /\bsearch(ing)?\b/,
      /\bfind(ing)?\b/,
      /\bfetch(ing)?\b/,
      /\bgrep\b/,
      /\brg\b/,
      /\bmetadata\b/,
      /\bscreenshot\b/,
      /\bview(ing)?\b/,
    ],
  },
  {
    phase: "listing-directory",
    patterns: [
      /\blist(ing)?\b/,
      /\bdirectory\b/,
      /\bworkspace\b/,
      /\bfiles\b/,
      /\bls\b/,
      /\btree\b/,
      /\bread_dir\b/,
    ],
  },
  {
    phase: "writing-files",
    patterns: [
      /\bwrite(ing)?\b/,
      /\bedit(ing)?\b/,
      /\bpatch(ing)?\b/,
      /\bapply_patch\b/,
      /\bupdate(ing)?\b/,
      /\bcreate(ing)?\b/,
      /\bdelete(ing)?\b/,
      /\brename(ing)?\b/,
      /\bmove\b/,
    ],
  },
  {
    phase: "verifying",
    patterns: [
      /\bverif(y|ying)\b/,
      /\btest(ing)?\b/,
      /\blint(ing)?\b/,
      /\bcheck(ing)?\b/,
      /\bbuild(ing)?\b/,
      /\bcompile(ing)?\b/,
      /\bformat(ting)?\b/,
      /\bvalidate(ing)?\b/,
    ],
  },
  {
    phase: "thinking",
    patterns: [
      /\bthink(ing)?\b/,
      /\bplan(ning)?\b/,
      /\bcompact(ing)?\b/,
      /\bretry(ing)?\b/,
    ],
  },
];

export function parseAssistantContent(
  content: string,
): AssistantContentBlock[] {
  const blocks: AssistantContentBlock[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(PLAN_BLOCK_PATTERN)) {
    const index = match.index ?? 0;
    const leading = content.slice(lastIndex, index);
    const normalizedLeading = trimEdgeBlankLines(leading);
    if (normalizedLeading.trim()) {
      blocks.push({ type: "markdown", content: normalizedLeading });
    }

    const planContent = (match[1] ?? "").trim();
    if (planContent) {
      blocks.push({ type: "proposed-plan", content: planContent });
    }

    lastIndex = index + match[0].length;
  }

  const trailing = content.slice(lastIndex);
  const normalizedTrailing = trimEdgeBlankLines(trailing);
  if (normalizedTrailing.trim() || blocks.length === 0) {
    blocks.push({
      type: "markdown",
      content: normalizedTrailing || content,
    });
  }

  return blocks;
}

export function resolveAssistantLabel(options: {
  session: ChatSession | null;
  workspace: WorkspaceRecord | null;
  workspaceCatalog: ProviderOption[];
  defaultProviders: ProviderOption[];
}) {
  const { session, workspace, workspaceCatalog, defaultProviders } = options;
  const providers =
    workspaceCatalog.length > 0 ? workspaceCatalog : defaultProviders;

  const runtimeModelId = session?.runtime.modelId?.trim();
  const workspaceModelId = workspace?.modelId?.trim();
  const modelId = runtimeModelId || workspaceModelId;

  if (modelId) {
    const model = providers
      .flatMap((provider) => provider.models)
      .find((entry) => entry.id === modelId);
    if (model?.label) {
      return model.label;
    }
    return humanizeRuntimeId(modelId);
  }

  const runtimeProviderId = session?.runtime.providerId?.trim();
  const workspaceProviderId = workspace?.providerId?.trim();
  const providerId = runtimeProviderId || workspaceProviderId;

  if (providerId) {
    const provider = providers.find((entry) => entry.id === providerId);
    if (provider?.label) {
      return provider.label;
    }
    return humanizeRuntimeId(providerId);
  }

  return "Assistant";
}

export function shortenAssistantLabel(label: string) {
  let shortened = label.replace(/\s*\([^)]*\)\s*$/g, "").trim();

  while (PRESENTATION_QUALIFIER_PATTERN.test(shortened)) {
    shortened = shortened.replace(PRESENTATION_QUALIFIER_PATTERN, "").trim();
  }

  return shortened || label;
}

export function resolveComposerCapabilities(options: {
  providers: ProviderOption[];
  providerId?: string | null;
  modelId?: string | null;
  effort?: string | null;
  fastMode?: boolean | null;
}): ComposerCapabilities {
  const { providers, providerId, modelId, effort, fastMode } = options;
  const provider = providers.find((entry) => entry.id === providerId);
  const model =
    provider?.models.find((entry) => entry.id === modelId) ??
    providers
      .flatMap((entry) => entry.models)
      .find((entry) => entry.id === modelId);

  const identity = [
    providerId,
    modelId,
    provider?.label,
    model?.label,
    model?.providerId,
  ]
    .filter(Boolean)
    .join(" ");
  const supportsFastMode = CODEX_PATTERN.test(identity);
  const effortOptions = supportsFastMode
    ? CODEX_EFFORT_OPTIONS
    : DEFAULT_EFFORT_OPTIONS;
  const supportedEfforts = new Set(effortOptions.map((entry) => entry.id));

  return {
    effortOptions,
    supportsFastMode,
    normalizedEffort:
      effort && supportedEfforts.has(effort) ? effort : DEFAULT_EFFORT,
    normalizedFastMode: supportsFastMode ? Boolean(fastMode) : false,
  };
}

export function deriveLivePhase(session: ChatSession | null): LivePhase | null {
  if (!session || session.status !== "streaming") {
    return null;
  }

  const recentItems = [...session.timeline].reverse();
  const activeTool = recentItems.find(
    (item) =>
      item.kind === "tool-activity" && item.activity.status === "running",
  );

  if (activeTool && activeTool.kind === "tool-activity") {
    const phase =
      classifyLivePhase(
        [
          activeTool.activity.toolName,
          activeTool.activity.summary,
          activeTool.activity.output,
        ].join(" "),
      ) ?? "thinking";

    return buildLivePhase(
      phase,
      activeTool.activity.summary || activeTool.activity.toolName,
    );
  }

  const recentNotice = recentItems.find(
    (item) => item.kind === "system-notice" || item.kind === "warning",
  );

  if (
    recentNotice &&
    (recentNotice.kind === "system-notice" || recentNotice.kind === "warning")
  ) {
    const phase = classifyLivePhase(
      `${recentNotice.title} ${recentNotice.detail}`.trim(),
    );

    if (phase) {
      return buildLivePhase(phase, recentNotice.detail || recentNotice.title);
    }
  }

  return buildLivePhase("thinking");
}

export function isTransientTimelineItem(item: TimelineItem) {
  if (item.kind === "tool-activity") {
    return item.activity.status === "running";
  }

  if (item.kind === "system-notice" || item.kind === "warning") {
    return classifyLivePhase(`${item.title} ${item.detail}`.trim()) !== null;
  }

  return false;
}

function classifyLivePhase(value: string): LivePhase["phase"] | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const matcher of TRANSIENT_STATUS_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(normalized))) {
      return matcher.phase;
    }
  }

  return null;
}

function buildLivePhase(phase: LivePhase["phase"], detail?: string): LivePhase {
  const labelMap: Record<LivePhase["phase"], string> = {
    "reading-files": "reading files",
    "listing-directory": "listing directory",
    "writing-files": "writing files",
    verifying: "verifying",
    thinking: "thinking",
  };

  return {
    phase,
    label: labelMap[phase],
    detail: phase === "thinking" ? undefined : detail?.trim() || undefined,
  };
}

function humanizeRuntimeId(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => {
      if (/^gpt$/i.test(segment)) {
        return "GPT";
      }
      if (/^\d+(\.\d+)?$/.test(segment)) {
        return segment;
      }

      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(" ");
}

function trimEdgeBlankLines(value: string) {
  return value.replace(/^\s*\n/, "").replace(/\n\s*$/, "");
}
