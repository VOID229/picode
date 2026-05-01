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
    | "searching"
    | "writing-files"
    | "running-command"
    | "verifying"
    | "thinking";
  label: string;
  detail?: string;
}

export type ActivityPhase = LivePhase["phase"] | "other";

export interface ActivitySegment {
  phase: ActivityPhase;
  items: TimelineItem[];
  isLive?: boolean;
  livePhase?: LivePhase;
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
  { id: "off", label: "Off" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "XHigh" },
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
      /\bfetch(ing)?\b/,
      /\blist(ing)?\b/,
      /\bls\b/,
      /\btree\b/,
      /\bdirectory\b/,
      /\bread_dir\b/,
      /\bmetadata\b/,
      /\bscreenshot\b/,
      /\bview(ing)?\b/,
    ],
  },
  {
    phase: "searching",
    patterns: [/\bsearch(ing)?\b/, /\bfind(ing)?\b/, /\bgrep\b/, /\brg\b/],
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
    phase: "running-command",
    patterns: [
      /\brun(ning)?\b/,
      /\bexec\b/,
      /\bbash\b/,
      /\bcommand\b/,
      /\bterminal\b/,
      /\bshell\b/,
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
        blocks.push({
          type: "proposed-plan",
          content: blockContent,
          isClosed: true,
        });
      } else if (tag === "think" || tag === "thought") {
        blocks.push({
          type: "thinking",
          content: blockContent,
          isClosed: true,
        });
      }
    }

    lastIndex = index + match[0].length;
  }

  const trailing = content.slice(lastIndex);

  // Try to match unclosed tags in the trailing content for streaming support
  const unclosedMatch = trailing.match(
    /<(proposed_plan|think|thought)>([\s\S]*)$/i,
  );
  if (unclosedMatch) {
    const leadingTrailing = trailing.slice(0, unclosedMatch.index);
    const normalizedLeadingTrailing = trimEdgeBlankLines(leadingTrailing);
    if (normalizedLeadingTrailing.trim()) {
      blocks.push({ type: "markdown", content: normalizedLeadingTrailing });
    }

    const tag = unclosedMatch[1].toLowerCase();
    const blockContent = (unclosedMatch[2] ?? "").trim();
    if (tag === "proposed_plan") {
      blocks.push({
        type: "proposed-plan",
        content: blockContent,
        isClosed: false,
      });
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
    const effort =
      normalizedSelection.effort === "extra-high"
        ? "xhigh"
        : normalizedSelection.effort;
    return {
      effortOptions: GENERIC_EFFORT_OPTIONS,
      supportsFastMode: false,
      normalizedSelection: {
        ...normalizedSelection,
        effort: supportedEfforts.has(effort) ? effort : DEFAULT_EFFORT,
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
    const phase = classifyLivePhase(
      [
        activeTool.activity.toolName,
        activeTool.activity.summary,
        activeTool.activity.output,
      ].join(" "),
    );

    if (phase) {
      return buildLivePhase(
        phase,
        activeTool.activity.summary || activeTool.activity.toolName,
      );
    }
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

  const lastAssistantMessage = recentItems.find(
    (item) => item.kind === "assistant-message",
  );

  if (
    lastAssistantMessage &&
    lastAssistantMessage.kind === "assistant-message" &&
    lastAssistantMessage.streaming &&
    lastAssistantMessage.content.trim().length > 0
  ) {
    return null;
  }

  const emptyStreamingAssistantMessage = recentItems.find(
    (item) =>
      item.kind === "assistant-message" &&
      item.streaming &&
      item.content.trim().length === 0,
  );

  if (emptyStreamingAssistantMessage) {
    return buildLivePhase("thinking");
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
    searching: "searching",
    "writing-files": "editing files",
    "running-command": "running command",
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
export type ToolFileAction = "read" | "edit" | "search" | "list";

export interface ToolFileSummary {
  path: string;
  actions: ToolFileAction[];
}

export interface ToolActivityDetails {
  files: ToolFileSummary[];
  rawCalls: ToolActivityItem[];
}

const TOOL_FILE_ACTION_ORDER: ToolFileAction[] = [
  "read",
  "edit",
  "search",
  "list",
];

const TOOL_PATH_PATTERNS = [
  /"path"\s*:\s*"([^"]+)"/g,
  /(^|[\s("'`])((?:\/|\.{1,2}\/)[^\s"'`),:;)}\]]+\/?)(?=$|[\s)"'`,:;)}\]])/g,
  /(^|[\s("'`])((?:[\w-]+\/)+[\w.@-]+\/?)(?=$|[\s)"'`,:;)}\]])/g,
];

export function classifyToolCategory(
  toolName: string,
  summary: string,
): ToolCategory {
  const text = `${toolName} ${summary}`.toLowerCase();

  if (/\b(search|find|grep|rg)\b/.test(text)) return "searched";
  if (
    /\b(write|edit|patch|apply_patch|create|delete|rename|move|update)\b/.test(
      text,
    )
  )
    return "edited";
  if (
    /\b(run|exec|command|terminal|shell|build|compile|test|lint|format|verify|check|validate)\b/.test(
      text,
    )
  )
    return "ran";
  return "explored";
}

export interface ToolGroupSummary {
  uniqueFiles: number;
  readFiles: number;
  edited: number;
  ran: number;
  searched: number;
  listed: number;
}

export function groupToolActivities(
  items: ToolActivityItem[],
  details?: ToolActivityDetails,
): ToolGroupSummary {
  const summary: ToolGroupSummary = {
    uniqueFiles: 0,
    readFiles: 0,
    edited: 0,
    ran: 0,
    searched: 0,
    listed: 0,
  };

  const fileDetails = details?.files ?? [];
  const uniquePaths = new Set<string>();
  if (fileDetails.length > 0) {
    for (const file of fileDetails) {
      if (file.actions.some((action) => action !== "search")) {
        uniquePaths.add(file.path);
      }
      if (file.actions.includes("read")) {
        summary.readFiles++;
      }
      if (file.actions.includes("edit")) {
        summary.edited++;
      }
      if (file.actions.includes("list")) {
        summary.listed++;
      }
    }
  } else {
    for (const item of items) {
      const action = classifyToolFileAction(item);
      if (action !== "search") {
        const paths = extractToolPaths(item.activity.summary);
        for (const path of paths) {
          uniquePaths.add(path);
        }
      }

      if (action === "read") {
        summary.readFiles++;
      } else if (action === "edit") {
        summary.edited++;
      } else if (action === "list") {
        summary.listed++;
      }
    }
  }

  summary.uniqueFiles = uniquePaths.size;
  if (summary.uniqueFiles === 0 && fileDetails.length > 0) {
    summary.uniqueFiles = fileDetails.length;
  }

  for (const item of items) {
    const category = classifyToolCategory(
      item.activity.toolName,
      item.activity.summary,
    );
    if (category === "searched") {
      summary.searched++;
    }
    if (category === "ran") {
      summary.ran++;
    }
  }
  return summary;
}

export function formatToolGroupLabel(
  summary: ToolGroupSummary,
  isLive = false,
): string {
  if (summary.ran > 0) return isLive ? "running command" : "ran command";
  if (summary.edited > 0) return isLive ? "editing files" : "edited files";
  if (summary.searched > 0) return isLive ? "searching" : "searched";
  if (summary.readFiles > 0 || summary.listed > 0 || summary.uniqueFiles > 0) {
    return isLive ? "reading files" : "read files";
  }
  return isLive ? "working" : "worked";
}

export function isLiveToolActivity(toolItems: ToolActivityItem[]): boolean {
  return toolItems.some((item) => item.activity.status === "running");
}

export function summarizeToolActivityDetails(
  items: ToolActivityItem[],
): ToolActivityDetails {
  const files = new Map<
    string,
    {
      path: string;
      actions: Set<ToolFileAction>;
    }
  >();

  for (const item of items) {
    const action = classifyToolFileAction(item);
    const paths = extractToolPaths(item.activity.summary);
    for (const path of paths) {
      const existing = files.get(path) ?? {
        path,
        actions: new Set<ToolFileAction>(),
      };
      existing.actions.add(action);
      files.set(path, existing);
    }
  }

  return {
    files: Array.from(files.values()).map((entry) => ({
      path: entry.path,
      actions: TOOL_FILE_ACTION_ORDER.filter((action) =>
        entry.actions.has(action),
      ),
    })),
    rawCalls: items,
  };
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
}

function splitLines(value: string): string[] {
  if (value.length === 0) {
    return [];
  }

  const lines = value.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function countLines(value: string): number {
  return splitLines(value).length;
}

function countLineDiff(
  before: string,
  after: string,
): {
  additions: number;
  deletions: number;
} {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= prefixLength &&
    afterEnd >= prefixLength &&
    beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const trimmedBefore = beforeLines.slice(prefixLength, beforeEnd + 1);
  const trimmedAfter = afterLines.slice(prefixLength, afterEnd + 1);

  if (trimmedBefore.length === 0) {
    return { additions: trimmedAfter.length, deletions: 0 };
  }

  if (trimmedAfter.length === 0) {
    return { additions: 0, deletions: trimmedBefore.length };
  }

  const lcs = new Uint32Array(trimmedAfter.length + 1);
  for (
    let beforeIndex = 1;
    beforeIndex <= trimmedBefore.length;
    beforeIndex++
  ) {
    let diagonal = 0;
    for (let afterIndex = 1; afterIndex <= trimmedAfter.length; afterIndex++) {
      const previous = lcs[afterIndex];
      if (trimmedBefore[beforeIndex - 1] === trimmedAfter[afterIndex - 1]) {
        lcs[afterIndex] = diagonal + 1;
      } else {
        lcs[afterIndex] = Math.max(lcs[afterIndex], lcs[afterIndex - 1]);
      }
      diagonal = previous;
    }
  }

  const sharedLength = lcs[trimmedAfter.length] ?? 0;
  return {
    additions: trimmedAfter.length - sharedLength,
    deletions: trimmedBefore.length - sharedLength,
  };
}

function parseToolArgs(summary: string): Record<string, unknown> | null {
  const jsonStart = summary.indexOf("{");
  if (jsonStart === -1) {
    return null;
  }

  try {
    const parsed = JSON.parse(summary.slice(jsonStart));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseOutputFileChange(
  output?: string,
): Pick<FileChange, "additions" | "deletions"> {
  if (!output) {
    return { additions: 0, deletions: 0 };
  }

  const addMatch = output.match(
    /(\d+)\s*(?:insertions?|additions?|lines? added|\+)/i,
  );
  const delMatch = output.match(
    /(\d+)\s*(?:deletions?|removals?|lines? (?:removed|deleted)|\-)/i,
  );

  return {
    additions: addMatch ? parseInt(addMatch[1], 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
  };
}

function deriveToolFileChange(item: ToolActivityItem): FileChange | null {
  const toolName = item.activity.toolName.trim().toLowerCase();
  const args = parseToolArgs(item.activity.summary);
  const path =
    typeof args?.path === "string"
      ? args.path
      : (extractToolPaths(item.activity.summary)[0] ?? null);

  if (!path) {
    return null;
  }

  if (toolName === "edit") {
    const edits = Array.isArray(args?.edits) ? args.edits : [];
    let additions = 0;
    let deletions = 0;
    let countedEdit = false;

    for (const edit of edits) {
      if (!edit || typeof edit !== "object") {
        continue;
      }

      const oldText =
        "oldText" in edit && typeof edit.oldText === "string"
          ? edit.oldText
          : null;
      const newText =
        "newText" in edit && typeof edit.newText === "string"
          ? edit.newText
          : null;

      if (oldText == null || newText == null) {
        continue;
      }

      countedEdit = true;
      const counts = countLineDiff(oldText, newText);
      additions += counts.additions;
      deletions += counts.deletions;
    }

    if (countedEdit) {
      return { path, additions, deletions };
    }
  }

  if (typeof args?.oldText === "string" && typeof args?.newText === "string") {
    const counts = countLineDiff(args.oldText, args.newText);
    return { path, additions: counts.additions, deletions: counts.deletions };
  }

  const outputCounts = parseOutputFileChange(item.activity.output);
  if (typeof args?.content === "string") {
    if (outputCounts.additions > 0 || outputCounts.deletions > 0) {
      return { path, ...outputCounts };
    }
    return { path, additions: countLines(args.content), deletions: 0 };
  }

  return { path, ...outputCounts };
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

    const nextChange = deriveToolFileChange(item);
    if (!nextChange) continue;

    const existing = changes.get(nextChange.path) ?? {
      path: nextChange.path,
      additions: 0,
      deletions: 0,
    };

    existing.additions += nextChange.additions;
    existing.deletions += nextChange.deletions;
    changes.set(nextChange.path, existing);
  }

  return Array.from(changes.values());
}

export interface TurnSegment {
  type: "text" | "activity" | "other";
  items: TimelineItem[];
  activityPhase?: ActivityPhase;
  isLive?: boolean;
  livePhase?: LivePhase;
}

/**
 * Groups timeline items from a single turn into segments of consecutive
 * activity vs. text/other items for cleaner rendering.
 */
export function segmentTurnItems(
  items: TimelineItem[],
  options?: {
    idleGapMs?: number;
    livePhase?: LivePhase | null;
  },
): TurnSegment[] {
  const segments: TurnSegment[] = [];
  let currentActivityItems: TimelineItem[] = [];
  let currentActivityPhase: ActivityPhase | null = null;

  const flushActivity = () => {
    if (currentActivityItems.length > 0 && currentActivityPhase) {
      segments.push({
        type: "activity",
        items: [...currentActivityItems],
        activityPhase: currentActivityPhase,
      });
      currentActivityItems = [];
      currentActivityPhase = null;
    }
  };

  for (const item of items) {
    const phase = classifyActivityPhaseForItem(item);

    if (phase) {
      currentActivityItems.push(item);
      currentActivityPhase = phase;
    } else if (item.kind === "assistant-message") {
      flushActivity();
      segments.push({ type: "text", items: [item] });
    } else {
      flushActivity();
      segments.push({ type: "other", items: [item] });
    }
  }

  flushActivity();

  if (options?.livePhase) {
    const lastSegment = segments[segments.length - 1];
    const lastSegmentHasRunningTool = lastSegment?.items.some(
      (item) =>
        item.kind === "tool-activity" && item.activity.status === "running",
    );
    if (
      lastSegment?.type === "activity" &&
      (options.livePhase.phase !== "thinking" || lastSegmentHasRunningTool)
    ) {
      lastSegment.isLive = true;
      lastSegment.livePhase = options.livePhase;
      lastSegment.activityPhase = options.livePhase.phase;
      return segments;
    }

    segments.push({
      type: "activity",
      items: [],
      activityPhase: options.livePhase.phase,
      isLive: true,
      livePhase: options.livePhase,
    });
  }

  return segments;
}

export function formatActivityPhaseLabel(
  phase: ActivityPhase,
  isLive = false,
): string {
  const liveLabels: Record<ActivityPhase, string> = {
    "reading-files": "reading files",
    searching: "searching",
    "writing-files": "editing files",
    "running-command": "running command",
    verifying: "verifying",
    thinking: "thinking",
    other: "working",
  };
  const completedLabels: Record<ActivityPhase, string> = {
    "reading-files": "read files",
    searching: "searched",
    "writing-files": "edited files",
    "running-command": "ran command",
    verifying: "verified",
    thinking: "thought",
    other: "worked",
  };

  return isLive ? liveLabels[phase] : completedLabels[phase];
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

function classifyToolFileAction(item: ToolActivityItem): ToolFileAction {
  const toolName = item.activity.toolName.trim().toLowerCase();
  const summary = item.activity.summary.trim().toLowerCase();
  const text = `${toolName} ${summary}`.trim();

  if (toolName === "read" || /\bread(ing)?\b/.test(text)) {
    return "read";
  }
  if (
    /\bls\b/.test(text) ||
    /\blist(ing)?\b/.test(text) ||
    /\bdirectory\b/.test(text) ||
    /\btree\b/.test(text)
  ) {
    return "list";
  }

  const category = classifyToolCategory(
    item.activity.toolName,
    item.activity.summary,
  );
  if (category === "edited") return "edit";
  if (category === "searched") return "search";
  return "read";
}

function classifyActivityPhaseForItem(
  item: TimelineItem,
): ActivityPhase | null {
  if (item.kind === "tool-activity") {
    const category = classifyToolCategory(
      item.activity.toolName,
      item.activity.summary,
    );
    if (category === "ran") return "running-command";
    if (category === "edited") return "writing-files";
    if (category === "searched") return "searching";

    return (
      classifyLivePhase(
        [item.activity.toolName, item.activity.summary, item.activity.output]
          .filter(Boolean)
          .join(" "),
      ) ?? "other"
    );
  }

  if (
    (item.kind === "system-notice" || item.kind === "warning") &&
    classifyLivePhase(`${item.title} ${item.detail}`.trim())
  ) {
    return classifyLivePhase(`${item.title} ${item.detail}`.trim()) ?? "other";
  }

  return null;
}

function getTimelineItemTimestamp(item: TimelineItem): number | null {
  const iso =
    item.kind === "tool-activity" ? item.activity.startedAt : item.createdAt;
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function extractToolPaths(summary: string): string[] {
  const paths = new Set<string>();

  for (const pattern of TOOL_PATH_PATTERNS) {
    for (const match of summary.matchAll(pattern)) {
      const candidate = normalizeToolPathCandidate(
        match[1] && match[2] ? match[2] : (match[1] ?? match[2] ?? ""),
      );
      if (candidate) {
        paths.add(candidate);
      }
    }
  }

  return Array.from(paths);
}

function normalizeToolPathCandidate(candidate: string): string | null {
  const normalized = candidate
    .trim()
    .replace(/^["'`(]+/, "")
    .replace(/[)"'`,:;]+$/, "")
    .replace(/\\(.)/g, "$1");

  if (!normalized) {
    return null;
  }

  const looksLikePath =
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.includes("/");

  if (!looksLikePath) {
    return null;
  }

  if (/^\w+:/.test(normalized) || normalized === "/") {
    return null;
  }

  return normalized;
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

export function resolveProviderSwitchSelection(options: {
  provider: ProviderOption | undefined;
  currentSelection: SessionModelSelection;
  providerModelMemory?: Record<string, SessionModelSelection>;
}): SessionModelSelection {
  const { provider, currentSelection, providerModelMemory } = options;

  if (!provider || provider.id === currentSelection.providerId) {
    return currentSelection;
  }

  const rememberedSelection = providerModelMemory?.[provider.id];
  if (
    rememberedSelection?.modelId &&
    provider.models.some((model) => model.id === rememberedSelection.modelId)
  ) {
    return {
      providerId: provider.id,
      modelId: rememberedSelection.modelId,
      effort: rememberedSelection.effort || currentSelection.effort,
      fastMode: Boolean(rememberedSelection.fastMode),
    };
  }

  return {
    providerId: provider.id,
    modelId: provider.models[0]?.id ?? currentSelection.modelId,
    effort: currentSelection.effort,
    fastMode: currentSelection.fastMode,
  };
}

export function resolveProviderSwitchModel(options: {
  provider: ProviderOption | undefined;
  currentProviderId: string;
  currentModelId: string;
  providerModelMemory?: Record<string, SessionModelSelection>;
}) {
  return resolveProviderSwitchSelection({
    provider: options.provider,
    currentSelection: {
      providerId: options.currentProviderId,
      modelId: options.currentModelId,
      effort: DEFAULT_EFFORT,
      fastMode: false,
    },
    providerModelMemory: options.providerModelMemory,
  }).modelId;
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

// ── Compact Tool Activity UI helpers ───────────────────────────

export type CompactToolPhase =
  | "searching"
  | "reading"
  | "editing"
  | "running"
  | "reviewing"
  | "thinking"
  | "done"
  | "error";

export type CompactToolItemType =
  | "search"
  | "read"
  | "edit"
  | "command"
  | "other";

export interface CompactToolItem {
  id: string;
  type: CompactToolItemType;
  label: string;
  path?: string;
  command?: string;
  status: "running" | "success" | "error";
  raw: ToolActivityItem;
}

export interface CompactToolState {
  phase: CompactToolPhase;
  currentLabel: string | null;
  items: CompactToolItem[];
}

export function mapActivityPhaseToCompact(
  phase: ActivityPhase,
  isLive: boolean,
): CompactToolPhase {
  if (!isLive) return "done";
  switch (phase) {
    case "searching":
      return "searching";
    case "reading-files":
      return "reading";
    case "writing-files":
      return "editing";
    case "running-command":
      return "running";
    case "verifying":
      return "reviewing";
    case "thinking":
      return "thinking";
    default:
      return "reading";
  }
}

function mapActivityStatus(
  status: ToolActivityItem["activity"]["status"],
): CompactToolItem["status"] {
  switch (status) {
    case "running":
      return "running";
    case "failed":
      return "error";
    case "completed":
    default:
      return "success";
  }
}

function mapToCompactItemType(item: ToolActivityItem): CompactToolItemType {
  const category = classifyToolCategory(
    item.activity.toolName,
    item.activity.summary,
  );
  switch (category) {
    case "searched":
      return "search";
    case "edited":
      return "edit";
    case "ran":
      return "command";
    case "explored":
    default:
      return "read";
  }
}

function extractCommandString(item: ToolActivityItem): string | undefined {
  const args = parseToolArgs(item.activity.summary);
  if (args && typeof args.command === "string" && args.command.trim()) {
    return args.command.trim();
  }
  if (args && typeof args.cmd === "string" && args.cmd.trim()) {
    return args.cmd.trim();
  }
  if (args && Array.isArray(args.command)) {
    const command = args.command
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .trim();
    if (command) {
      return command;
    }
  }
  if (args && Array.isArray(args.cmd)) {
    const command = args.cmd
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .trim();
    if (command) {
      return command;
    }
  }
  const toolName = item.activity.toolName.trim().toLowerCase();
  if (
    ["bash", "shell", "run", "exec", "command", "exec_command"].includes(
      toolName,
    )
  ) {
    // Try to extract a bare command from the summary when it's not JSON-wrapped
    const summary = item.activity.summary.trim();
    const firstBrace = summary.indexOf("{");
    if (firstBrace === -1) {
      return summary || undefined;
    }
    // If there's text before the JSON, treat it as the command
    const preamble = summary.slice(0, firstBrace).trim();
    if (preamble) {
      return preamble;
    }
  }
  return undefined;
}

export function deriveCompactToolItems(
  segment: ActivitySegment,
): CompactToolItem[] {
  return segment.items
    .filter((item): item is ToolActivityItem => item.kind === "tool-activity")
    .map((item) => {
      const type = mapToCompactItemType(item);
      const paths = extractToolPaths(item.activity.summary);
      const command =
        type === "command" ? extractCommandString(item) : undefined;
      const path = paths[0] ?? undefined;

      let label: string;
      if (type === "command" && command) {
        label = command;
      } else if (path) {
        label = path;
      } else {
        label = item.activity.toolName;
      }

      return {
        id: item.id,
        type,
        label,
        path,
        command,
        status: mapActivityStatus(item.activity.status),
        raw: item,
      };
    });
}

export function deriveCompactToolState(
  segment: ActivitySegment,
): CompactToolState {
  const items = deriveCompactToolItems(segment);
  const phase = mapActivityPhaseToCompact(
    segment.phase,
    Boolean(segment.isLive),
  );

  const currentLabel = segment.isLive ? formatCompactLiveLabel(phase) : null;

  return { phase, currentLabel, items };
}

export function formatCompactLiveLabel(phase: CompactToolPhase): string {
  switch (phase) {
    case "searching":
      return "Searching…";
    case "reading":
      return "Reading files…";
    case "editing":
      return "Editing files…";
    case "running":
      return "Running commands…";
    case "reviewing":
      return "Reviewing…";
    case "thinking":
      return "Thinking…";
    case "error":
      return "Error";
    case "done":
    default:
      return "Working…";
  }
}

export function formatCompactSummary(items: CompactToolItem[]): string {
  const counts: Record<CompactToolItemType, number> = {
    search: 0,
    read: 0,
    edit: 0,
    command: 0,
    other: 0,
  };
  for (const item of items) {
    counts[item.type]++;
  }

  const parts: string[] = [];
  if (counts.read > 0) parts.push(`Read ${counts.read}`);
  if (counts.edit > 0) parts.push(`Edited ${counts.edit}`);
  if (counts.command > 0) parts.push(`Commands ${counts.command}`);
  if (counts.search > 0) parts.push(`Searched ${counts.search}`);
  if (counts.other > 0) parts.push(`Other ${counts.other}`);

  if (parts.length === 0) return "Tools used";
  return `Tools used: ${parts.join(" · ")}`;
}

export function groupCompactToolItems(
  items: CompactToolItem[],
): Record<CompactToolItemType, CompactToolItem[]> {
  const groups: Record<CompactToolItemType, CompactToolItem[]> = {
    search: [],
    read: [],
    edit: [],
    command: [],
    other: [],
  };
  for (const item of items) {
    groups[item.type].push(item);
  }
  return groups;
}

export function formatCompactGroupLabel(type: CompactToolItemType): string {
  switch (type) {
    case "search":
      return "Searched";
    case "read":
      return "Read files";
    case "edit":
      return "Edited files";
    case "command":
      return "Commands";
    case "other":
      return "Other";
  }
}

export function formatCompactGroupLabelRunning(
  type: CompactToolItemType,
): string {
  switch (type) {
    case "search":
      return "Searching";
    case "read":
      return "Reading files";
    case "edit":
      return "Editing files";
    case "command":
      return "Commands running";
    case "other":
      return "Working";
  }
}

export interface CompactListResult {
  visible: CompactToolItem[];
  hiddenCount: number;
}

export function compactItemList(
  items: CompactToolItem[],
  maxVisible = 6,
): CompactListResult {
  const seen = new Set<string>();
  const unique: CompactToolItem[] = [];
  for (const item of items) {
    if (!seen.has(item.label)) {
      seen.add(item.label);
      unique.push(item);
    }
  }
  return {
    visible: unique.slice(0, maxVisible),
    hiddenCount: Math.max(0, unique.length - maxVisible),
  };
}
