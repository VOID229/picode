import type {
  ChatSession,
  ProviderOption,
  SessionModelSelection,
  TimelineItem,
  ToolActivityItem,
  WorkspaceRecord,
} from "../../domains/types";

export interface AssistantContentBlock {
  type: "markdown" | "proposed-plan" | "thinking";
  content: string;
  isClosed?: boolean;
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
  normalizedSelection: SessionModelSelection;
}

const BLOCK_PATTERN = /<(proposed_plan|think|thought)>\s*([\s\S]*?)\s*<\/\1>/gi;
const DEFAULT_EFFORT = "high";
const GENERIC_EFFORT_OPTIONS: ComposerEffortOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];
const CODEX_EFFORT_OPTIONS: ComposerEffortOption[] = [
  ...GENERIC_EFFORT_OPTIONS,
  { id: "extra-high", label: "XHigh" },
];
const ANTIGRAVITY_EFFORT_OPTIONS: ComposerEffortOption[] = [
  { id: "fast", label: "Fast" },
  { id: "planning", label: "Planning" },
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

  for (const match of content.matchAll(BLOCK_PATTERN)) {
    const index = match.index ?? 0;
    const leading = content.slice(lastIndex, index);
    const normalizedLeading = trimEdgeBlankLines(leading);
    if (normalizedLeading.trim()) {
      blocks.push({ type: "markdown", content: normalizedLeading });
    }

    const tag = match[1].toLowerCase();
    const blockContent = (match[2] ?? "").trim();
    if (blockContent) {
      if (tag === "proposed_plan") {
        blocks.push({ type: "proposed-plan", content: blockContent, isClosed: true });
      } else if (tag === "think" || tag === "thought") {
        blocks.push({ type: "thinking", content: blockContent, isClosed: true });
      }
    }

    lastIndex = index + match[0].length;
  }

  const trailing = content.slice(lastIndex);
  
  // Try to match unclosed tags in the trailing content for streaming support
  const unclosedMatch = trailing.match(/<(proposed_plan|think|thought)>([\s\S]*)$/i);
  if (unclosedMatch) {
    const leadingTrailing = trailing.slice(0, unclosedMatch.index);
    const normalizedLeadingTrailing = trimEdgeBlankLines(leadingTrailing);
    if (normalizedLeadingTrailing.trim()) {
      blocks.push({ type: "markdown", content: normalizedLeadingTrailing });
    }
    
    const tag = unclosedMatch[1].toLowerCase();
    const blockContent = (unclosedMatch[2] ?? "").trim();
    if (tag === "proposed_plan") {
      blocks.push({ type: "proposed-plan", content: blockContent, isClosed: false });
    } else if (tag === "think" || tag === "thought") {
      blocks.push({ type: "thinking", content: blockContent, isClosed: false });
    }
  } else {
    const normalizedTrailing = trimEdgeBlankLines(trailing);
    if (normalizedTrailing.trim() || blocks.length === 0) {
      blocks.push({
        type: "markdown",
        content: normalizedTrailing || content,
      });
    }
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
  const selection = resolveSessionSelection(session, workspace);
  const modelId = runtimeModelId || selection.modelId;

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
  const providerId = runtimeProviderId || selection.providerId;

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
  return label.replace(/\s*\((?:[^)]*)\)\s*$/g, "").trim() || label;
}

export function resolveSessionSelection(
  session: ChatSession | null,
  workspace: WorkspaceRecord | null,
): SessionModelSelection {
  return {
    providerId: session?.selection?.providerId || workspace?.providerId || "",
    modelId: session?.selection?.modelId || workspace?.modelId || "",
    effort: session?.selection?.effort || workspace?.effort || DEFAULT_EFFORT,
    fastMode: session?.selection?.fastMode ?? workspace?.fastMode ?? false,
  };
}

export function resolveComposerCapabilities(options: {
  providers: ProviderOption[];
  selection: SessionModelSelection;
}): ComposerCapabilities {
  const normalizedSelection = normalizeSelectionAgainstProviders(
    options.selection,
    options.providers,
  );
  const provider = options.providers.find(
    (entry) => entry.id === normalizedSelection.providerId,
  );
  const model = provider?.models.find(
    (entry) => entry.id === normalizedSelection.modelId,
  );

  if (provider?.id === "openai-codex") {
    const effortOptions = CODEX_EFFORT_OPTIONS;
    const supportedEfforts = new Set(effortOptions.map((entry) => entry.id));
    return {
      effortOptions,
      supportsFastMode: true,
      normalizedSelection: {
        ...normalizedSelection,
        effort: supportedEfforts.has(normalizedSelection.effort)
          ? normalizedSelection.effort
          : DEFAULT_EFFORT,
        fastMode: Boolean(normalizedSelection.fastMode),
      },
    };
  }

  if (provider?.id === "google-antigravity" && model) {
    const pair = resolveAntigravityPair(provider, model.id);
    if (pair) {
      const effort =
        normalizedSelection.effort === "planning" ||
        normalizedSelection.effort === "fast"
          ? normalizedSelection.effort
          : pair.planningModelId === model.id
            ? "planning"
            : "fast";

      return {
        effortOptions: ANTIGRAVITY_EFFORT_OPTIONS,
        supportsFastMode: false,
        normalizedSelection: {
          ...normalizedSelection,
          modelId:
            effort === "planning" ? pair.planningModelId : pair.fastModelId,
          effort,
          fastMode: false,
        },
      };
    }

    return {
      effortOptions: [],
      supportsFastMode: false,
      normalizedSelection: {
        ...normalizedSelection,
        fastMode: false,
      },
    };
  }

  if (model?.reasoning) {
    const supportedEfforts = new Set(
      GENERIC_EFFORT_OPTIONS.map((entry) => entry.id),
    );
    return {
      effortOptions: GENERIC_EFFORT_OPTIONS,
      supportsFastMode: false,
      normalizedSelection: {
        ...normalizedSelection,
        effort: supportedEfforts.has(normalizedSelection.effort)
          ? normalizedSelection.effort
          : DEFAULT_EFFORT,
        fastMode: false,
      },
    };
  }

  return {
    effortOptions: [],
    supportsFastMode: false,
    normalizedSelection: {
      ...normalizedSelection,
      fastMode: false,
    },
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

  // If the most recent item is an assistant message that's actively streaming
  // tokens, don't show "thinking" — the text itself is appearing.
  const lastItem = recentItems[0];
  if (
    lastItem &&
    lastItem.kind === "assistant-message" &&
    lastItem.streaming &&
    lastItem.content.trim().length > 0
  ) {
    return null;
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

export type ToolCategory = "explored" | "edited" | "ran" | "searched";

export function classifyToolCategory(
  toolName: string,
  summary: string,
): ToolCategory {
  const text = `${toolName} ${summary}`.toLowerCase();

  if (/\b(search|find|grep|rg)\b/.test(text)) return "searched";
  if (/\b(write|edit|patch|apply_patch|create|delete|rename|move|update)\b/.test(text)) return "edited";
  if (/\b(run|exec|command|terminal|shell|build|compile|test|lint|format|verify|check|validate)\b/.test(text)) return "ran";
  return "explored";
}

export interface ToolGroupSummary {
  explored: number;
  edited: number;
  ran: number;
  searched: number;
}

export function groupToolActivities(
  items: ToolActivityItem[],
): ToolGroupSummary {
  const summary: ToolGroupSummary = { explored: 0, edited: 0, ran: 0, searched: 0 };
  for (const item of items) {
    const category = classifyToolCategory(
      item.activity.toolName,
      item.activity.summary,
    );
    summary[category]++;
  }
  return summary;
}

export function formatToolGroupLabel(summary: ToolGroupSummary): string {
  const parts: string[] = [];
  if (summary.explored > 0) parts.push(`Explored ${summary.explored} file${summary.explored !== 1 ? "s" : ""}`);
  if (summary.edited > 0) parts.push(`edited ${summary.edited} file${summary.edited !== 1 ? "s" : ""}`);
  if (summary.ran > 0) parts.push(`ran ${summary.ran} command${summary.ran !== 1 ? "s" : ""}`);
  if (summary.searched > 0) parts.push(`searched ${summary.searched} time${summary.searched !== 1 ? "s" : ""}`);
  if (parts.length === 0) return "Working...";
  // Capitalize only the very first part
  return parts.join(", ");
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
}

export function extractFileChanges(
  toolItems: ToolActivityItem[],
): FileChange[] {
  const changes = new Map<string, FileChange>();

  for (const item of toolItems) {
    const category = classifyToolCategory(
      item.activity.toolName,
      item.activity.summary,
    );
    if (category !== "edited") continue;

    // Try to extract file path from summary (common patterns)
    const summaryPathMatch = item.activity.summary.match(
      /(?:^|\s)([\w./\-]+\.[a-zA-Z]{1,10})(?:\s|$)/,
    );
    const path = summaryPathMatch?.[1];
    if (!path) continue;

    const existing = changes.get(path) ?? { path, additions: 0, deletions: 0 };

    // Try to parse +N -M from output
    if (item.activity.output) {
      const addMatch = item.activity.output.match(/(\d+)\s*(?:insertions?|additions?|lines? added|\+)/i);
      const delMatch = item.activity.output.match(/(\d+)\s*(?:deletions?|removals?|lines? (?:removed|deleted)|\-)/i);
      if (addMatch) existing.additions += parseInt(addMatch[1], 10);
      if (delMatch) existing.deletions += parseInt(delMatch[1], 10);
    }

    // If we couldn't parse stats, estimate from output length
    if (existing.additions === 0 && existing.deletions === 0 && item.activity.output) {
      existing.additions = item.activity.output.length;
    }

    changes.set(path, existing);
  }

  return Array.from(changes.values());
}

export interface TurnSegment {
  type: "text" | "tool-group" | "other";
  items: TimelineItem[];
}

/**
 * Groups timeline items from a single turn into segments of consecutive
 * tool activities vs. text/other items for cleaner rendering.
 */
export function segmentTurnItems(items: TimelineItem[]): TurnSegment[] {
  const segments: TurnSegment[] = [];
  let currentToolItems: TimelineItem[] = [];

  const flushTools = () => {
    if (currentToolItems.length > 0) {
      segments.push({ type: "tool-group", items: [...currentToolItems] });
      currentToolItems = [];
    }
  };

  for (const item of items) {
    if (item.kind === "tool-activity") {
      currentToolItems.push(item);
    } else if (
      item.kind === "system-notice" ||
      item.kind === "warning"
    ) {
      // Transient status items go with tool groups
      currentToolItems.push(item);
    } else if (item.kind === "assistant-message") {
      flushTools();
      segments.push({ type: "text", items: [item] });
    } else {
      flushTools();
      segments.push({ type: "other", items: [item] });
    }
  }

  flushTools();
  return segments;
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

function normalizeSelectionAgainstProviders(
  selection: SessionModelSelection,
  providers: ProviderOption[],
): SessionModelSelection {
  const firstProvider = providers[0];
  const fallbackProviderId = firstProvider?.id ?? selection.providerId;
  const provider =
    providers.find((entry) => entry.id === selection.providerId) ??
    firstProvider;
  const fallbackModelId =
    provider?.models.find((entry) => entry.id === selection.modelId)?.id ??
    provider?.models[0]?.id ??
    selection.modelId;

  return {
    providerId: provider?.id ?? fallbackProviderId,
    modelId: fallbackModelId,
    effort: selection.effort || DEFAULT_EFFORT,
    fastMode: Boolean(selection.fastMode),
  };
}

function resolveAntigravityPair(provider: ProviderOption, modelId: string) {
  const current = provider.models.find((entry) => entry.id === modelId);
  if (!current) {
    return null;
  }

  if (modelId.endsWith("-thinking")) {
    const fastModelId = modelId.slice(0, -"-thinking".length);
    if (provider.models.some((entry) => entry.id === fastModelId)) {
      return {
        fastModelId,
        planningModelId: modelId,
      };
    }
    return null;
  }

  const planningModelId = `${modelId}-thinking`;
  if (provider.models.some((entry) => entry.id === planningModelId)) {
    return {
      fastModelId: modelId,
      planningModelId,
    };
  }

  return null;
}
