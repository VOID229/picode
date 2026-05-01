import { describe, expect, it } from "bun:test";
import type {
  ChatSession,
  ProviderOption,
  WorkspaceRecord,
} from "../../domains/types";
import {
  formatActivityPhaseLabel,
  formatToolGroupLabel,
  deriveLivePhase,
  extractFileChanges,
  groupToolActivities,
  parseAssistantContent,
  resolveComposerCapabilities,
  resolveProviderSwitchModel,
  resolveAssistantLabel,
  resolveSessionSelection,
  segmentTurnItems,
  shortenAssistantLabel,
  summarizeToolActivityDetails,
} from "./chatRuntime";

const defaultProviders: ProviderOption[] = [
  {
    id: "openai-codex",
    label: "Codex",
    status: "ready",
    authKind: "oauth",
    available: true,
    models: [
      {
        id: "gpt-5.4",
        label: "GPT-5.4",
        providerId: "openai-codex",
        contextWindow: "256k",
        reasoning: true,
        available: true,
        providerSource: "pi",
      },
    ],
  },
];

function createWorkspace(): WorkspaceRecord {
  return {
    id: "workspace-1",
    name: "Demo",
    path: "/tmp/demo",
    pinned: false,
    recentRank: 1,
    approvalMode: "supervised",
    policy: {
      allowedPaths: [],
      allowedCommands: [],
      envPassthrough: [],
      networkEnabled: false,
    },
    providerId: "openai-codex",
    modelId: "gpt-5.4",
    effort: "high",
    fastMode: false,
    sessions: [],
  };
}

function createSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    id: "session-1",
    title: "Chat 1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "idle",
    selection: {
      providerId: "openai-codex",
      modelId: "gpt-5.4",
      effort: "high",
      fastMode: false,
    },
    runtime: {
      lastKnownReady: false,
    },
    timeline: [],
    ...overrides,
  };
}

describe("parseAssistantContent", () => {
  it("splits markdown and proposed plan blocks", () => {
    expect(
      parseAssistantContent(
        "Intro\n<proposed_plan>\n# Plan\n- item\n</proposed_plan>\nOutro",
      ),
    ).toEqual([
      { type: "markdown", content: "Intro" },
      { type: "proposed-plan", content: "# Plan\n- item", isClosed: true },
      { type: "markdown", content: "Outro" },
    ]);
  });

  it("marks unclosed thinking blocks as open while streaming", () => {
    expect(parseAssistantContent("<think>\nInspecting state")).toEqual([
      {
        type: "thinking",
        content: "Inspecting state",
        isClosed: false,
      },
    ]);
  });
});

describe("resolveAssistantLabel", () => {
  it("prefers runtime model metadata", () => {
    const session = createSession({
      runtime: {
        providerId: "openai-codex",
        modelId: "gpt-5.4",
        lastKnownReady: true,
      },
    });

    expect(
      resolveAssistantLabel({
        session,
        workspace: createWorkspace(),
        workspaceCatalog: [],
        defaultProviders,
      }),
    ).toBe("GPT-5.4");
  });
});

describe("shortenAssistantLabel", () => {
  it("removes provider suffixes and keeps semantic variants", () => {
    expect(shortenAssistantLabel("GPT-OSS 120B Medium (Antigravity)")).toBe(
      "GPT-OSS 120B Medium",
    );
  });
});

describe("resolveComposerCapabilities", () => {
  it("supports the full reasoning ladder globally without fast mode", () => {
    expect(
      resolveComposerCapabilities({
        providers: [
          {
            id: "anthropic",
            label: "Claude",
            status: "ready",
            authKind: "oauth",
            available: true,
            models: [
              {
                id: "claude-sonnet-4-5",
                label: "Claude Sonnet 4.5",
                providerId: "anthropic",
                contextWindow: "200k",
                reasoning: true,
                available: true,
                providerSource: "pi",
              },
            ],
          },
        ],
        selection: {
          providerId: "anthropic",
          modelId: "claude-sonnet-4-5",
          effort: "xhigh",
          fastMode: true,
        },
      }),
    ).toMatchObject({
      supportsFastMode: false,
      normalizedSelection: {
        effort: "xhigh",
        fastMode: false,
      },
    });
  });

  it("migrates stale extra-high selection to xhigh globally", () => {
    expect(
      resolveComposerCapabilities({
        providers: defaultProviders,
        selection: {
          providerId: "openai-codex",
          modelId: "gpt-5.4",
          effort: "extra-high",
          fastMode: false,
        },
      }).normalizedSelection.effort,
    ).toBe("xhigh");
  });

  it("treats antigravity thinking model pairs as fast/planning modes", () => {
    expect(
      resolveComposerCapabilities({
        providers: [
          ...defaultProviders,
          {
            id: "anthropic",
            label: "Claude",
            status: "ready",
            authKind: "oauth",
            available: true,
            models: [
              {
                id: "claude-sonnet-4-5",
                label: "Claude Sonnet 4.5",
                providerId: "anthropic",
                contextWindow: "200k",
                reasoning: false,
                available: true,
                providerSource: "pi",
              },
            ],
          },
          {
            id: "google-antigravity",
            label: "Antigravity",
            status: "ready",
            authKind: "oauth",
            available: true,
            models: [
              {
                id: "claude-sonnet-4-5",
                label: "Claude Sonnet 4.5",
                providerId: "google-antigravity",
                contextWindow: "200k",
                reasoning: false,
                available: true,
                providerSource: "pi",
              },
              {
                id: "claude-sonnet-4-5-thinking",
                label: "Claude Sonnet 4.5 Thinking",
                providerId: "google-antigravity",
                contextWindow: "200k",
                reasoning: true,
                available: true,
                providerSource: "pi",
              },
            ],
          },
        ],
        selection: {
          providerId: "google-antigravity",
          modelId: "claude-sonnet-4-5",
          effort: "planning",
          fastMode: false,
        },
      }),
    ).toMatchObject({
      supportsFastMode: false,
      normalizedSelection: {
        modelId: "claude-sonnet-4-5-thinking",
        effort: "planning",
        fastMode: false,
      },
    });
  });
});

describe("resolveProviderSwitchModel", () => {
  const providers: ProviderOption[] = [
    {
      id: "openai-codex",
      label: "Codex",
      status: "ready",
      authKind: "oauth",
      available: true,
      models: [
        {
          id: "gpt-5.4-mini",
          label: "GPT-5.4 Mini",
          providerId: "openai-codex",
          contextWindow: "256k",
          reasoning: true,
          available: true,
          providerSource: "pi",
        },
        {
          id: "gpt-5.4",
          label: "GPT-5.4",
          providerId: "openai-codex",
          contextWindow: "256k",
          reasoning: true,
          available: true,
          providerSource: "pi",
        },
      ],
    },
    {
      id: "anthropic",
      label: "Claude",
      status: "ready",
      authKind: "oauth",
      available: true,
      models: [
        {
          id: "claude-haiku",
          label: "Claude Haiku",
          providerId: "anthropic",
          contextWindow: "200k",
          reasoning: false,
          available: true,
          providerSource: "pi",
        },
        {
          id: "claude-sonnet",
          label: "Claude Sonnet",
          providerId: "anthropic",
          contextWindow: "200k",
          reasoning: true,
          available: true,
          providerSource: "pi",
        },
      ],
    },
  ];

  it("keeps the current model when the same provider is selected", () => {
    expect(
      resolveProviderSwitchModel({
        provider: providers[0],
        currentProviderId: "openai-codex",
        currentModelId: "gpt-5.4",
        providerModelMemory: {},
      }),
    ).toBe("gpt-5.4");
  });

  it("restores the target provider's last selected model", () => {
    expect(
      resolveProviderSwitchModel({
        provider: providers[1],
        currentProviderId: "openai-codex",
        currentModelId: "gpt-5.4",
        providerModelMemory: {
          anthropic: {
            providerId: "anthropic",
            modelId: "claude-sonnet",
            effort: "high",
            fastMode: false,
          },
        },
      }),
    ).toBe("claude-sonnet");
  });
});

describe("resolveSessionSelection", () => {
  it("prefers session selection over workspace defaults", () => {
    const workspace = createWorkspace();
    const session = createSession({
      selection: {
        providerId: "openai-codex",
        modelId: "gpt-5.4",
        effort: "low",
        fastMode: true,
      },
    });

    expect(resolveSessionSelection(session, workspace)).toEqual({
      providerId: "openai-codex",
      modelId: "gpt-5.4",
      effort: "low",
      fastMode: true,
    });
  });
});

describe("deriveLivePhase", () => {
  it("maps running tool activity into canonical phases", () => {
    const session = createSession({
      status: "streaming",
      timeline: [
        {
          id: "tool-1",
          kind: "tool-activity",
          createdAt: new Date().toISOString(),
          activity: {
            id: "tool-1",
            toolName: "read_file",
            summary: "reading src/components/chat/ConversationView.tsx",
            status: "running",
            startedAt: new Date().toISOString(),
          },
        },
      ],
    });

    expect(deriveLivePhase(session)?.phase).toBe("reading-files");
    expect(deriveLivePhase(session)?.label).toBe("reading files");
  });

  it("shows thinking while a streaming turn has no visible work yet", () => {
    const session = createSession({
      status: "streaming",
    });

    expect(deriveLivePhase(session)).toMatchObject({
      phase: "thinking",
      label: "thinking",
    });
  });

  it("shows thinking while the assistant is streaming but has no visible text yet", () => {
    const session = createSession({
      status: "streaming",
      timeline: [
        {
          id: "assistant-1",
          kind: "assistant-message",
          content: "",
          createdAt: new Date().toISOString(),
          streaming: true,
        },
      ],
    });

    expect(deriveLivePhase(session)).toMatchObject({
      phase: "thinking",
      label: "thinking",
    });
  });

  it("does not emit generic thinking when assistant text is already streaming", () => {
    const session = createSession({
      status: "streaming",
      timeline: [
        {
          id: "assistant-1",
          kind: "assistant-message",
          content: "<think>\nInspecting the workspace",
          createdAt: new Date().toISOString(),
          streaming: true,
        },
      ],
    });

    expect(deriveLivePhase(session)).toBeNull();
  });
});

describe("summarizeToolActivityDetails", () => {
  it("dedupes file paths and prioritizes file summaries", () => {
    const now = new Date().toISOString();
    const details = summarizeToolActivityDetails([
      {
        id: "tool-1",
        kind: "tool-activity",
        createdAt: now,
        activity: {
          id: "tool-1",
          toolName: "read",
          summary:
            'read {"path":"src/components/chat/ConversationView.tsx","limit":40}',
          status: "completed",
          startedAt: now,
        },
      },
      {
        id: "tool-2",
        kind: "tool-activity",
        createdAt: now,
        activity: {
          id: "tool-2",
          toolName: "bash",
          summary:
            'grep -n "selection" src/components/chat/ConversationView.tsx',
          status: "completed",
          startedAt: now,
        },
      },
    ]);

    expect(details.files).toEqual([
      {
        path: "src/components/chat/ConversationView.tsx",
        actions: ["read", "search"],
      },
    ]);
    expect(details.rawCalls).toHaveLength(2);
  });

  it("formats live and completed activity labels without counts", () => {
    const now = new Date().toISOString();
    const toolItems = [
      createToolActivity({
        id: "tool-1",
        toolName: "read",
        summary:
          'read {"path":"src/components/chat/ConversationView.tsx","limit":40}',
        status: "running",
        createdAt: now,
      }),
      createToolActivity({
        id: "tool-2",
        toolName: "read",
        summary:
          'read {"path":"src/components/chat/ToolActivityGroup.tsx","limit":40}',
        status: "running",
        createdAt: now,
      }),
      createToolActivity({
        id: "tool-3",
        toolName: "grep",
        summary: 'grep -n "ToolActivityGroup" src/components/chat',
        status: "completed",
        createdAt: now,
      }),
    ];
    const details = summarizeToolActivityDetails(toolItems);
    const summary = groupToolActivities(toolItems, details);

    expect(formatToolGroupLabel(summary, true)).toBe("searching");
    expect(formatToolGroupLabel(summary, false)).toBe("searched");
  });

  it("dedupes edited files across multiple tool calls", () => {
    const now = new Date().toISOString();
    const toolItems = [
      createToolActivity({
        id: "tool-1",
        toolName: "edit",
        summary:
          'edit {"path":"src/app.ts","edits":[{"oldText":"foo","newText":"bar"}]}',
        status: "completed",
        createdAt: now,
      }),
      createToolActivity({
        id: "tool-2",
        toolName: "edit",
        summary:
          'edit {"path":"src/routes.ts","edits":[{"oldText":"baz","newText":"qux"}]}',
        status: "completed",
        createdAt: now,
      }),
    ];
    const details = summarizeToolActivityDetails(toolItems);
    const summary = groupToolActivities(toolItems, details);

    expect(details.files).toHaveLength(2);
    expect(formatToolGroupLabel(summary, false)).toBe("edited files");
  });

  it("uses present tense only for active activity phases", () => {
    expect(formatActivityPhaseLabel("reading-files", true)).toBe(
      "reading files",
    );
    expect(formatActivityPhaseLabel("reading-files", false)).toBe("read files");
    expect(formatActivityPhaseLabel("running-command", true)).toBe(
      "running command",
    );
    expect(formatActivityPhaseLabel("running-command", false)).toBe(
      "ran command",
    );
  });
});

describe("extractFileChanges", () => {
  it("computes exact added and removed lines from edit tool arguments", () => {
    const now = new Date().toISOString();
    const changes = extractFileChanges([
      createToolActivity({
        id: "tool-1",
        toolName: "edit",
        summary:
          'edit {"path":"src/app.ts","edits":[{"oldText":"foo\\nbar","newText":"foo\\nbaz\\nqux"},{"oldText":"line1","newText":""}]}',
        createdAt: now,
      }),
      createToolActivity({
        id: "tool-2",
        toolName: "edit",
        summary:
          'edit {"path":"src/app.ts","edits":[{"oldText":"alpha\\nbeta","newText":"alpha\\ngamma"}]}',
        createdAt: now,
      }),
    ]);

    expect(changes).toEqual([
      {
        path: "src/app.ts",
        additions: 3,
        deletions: 3,
      },
    ]);
  });

  it("counts written file content directly instead of guessing from tool output", () => {
    const now = new Date().toISOString();
    const changes = extractFileChanges([
      {
        id: "tool-1",
        kind: "tool-activity",
        createdAt: now,
        activity: {
          id: "tool-1",
          toolName: "write",
          summary: 'write {"path":"src/new-file.ts","content":"a\\nb\\nc"}',
          output: "Successfully wrote file",
          status: "completed",
          startedAt: now,
        },
      },
    ]);

    expect(changes).toEqual([
      {
        path: "src/new-file.ts",
        additions: 3,
        deletions: 0,
      },
    ]);
  });

  it("does not fall back to arbitrary output length when exact counts are unavailable", () => {
    const now = new Date().toISOString();
    const changes = extractFileChanges([
      {
        id: "tool-1",
        kind: "tool-activity",
        createdAt: now,
        activity: {
          id: "tool-1",
          toolName: "apply_patch",
          summary: 'apply_patch "*** Update File: src/app.ts"',
          output: "Patch applied successfully.",
          status: "completed",
          startedAt: now,
        },
      },
    ]);

    expect(changes).toEqual([
      {
        path: "src/app.ts",
        additions: 0,
        deletions: 0,
      },
    ]);
  });
});

describe("segmentTurnItems", () => {
  it("keeps phase changes in one compact activity row", () => {
    const segments = segmentTurnItems([
      createToolActivity({
        id: "tool-1",
        summary:
          'apply_patch "*** Update File: src/components/chat/chatRuntime.ts"',
        createdAt: "2026-04-22T09:00:00.000Z",
        toolName: "apply_patch",
      }),
      createToolActivity({
        id: "tool-2",
        toolName: "read",
        summary:
          'read {"path":"src/components/chat/chatRuntime.ts","limit":120}',
        createdAt: "2026-04-22T09:00:00.500Z",
      }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      type: "activity",
      activityPhase: "reading-files",
    });
    expect((segments[0].items[0] as { id: string }).id).toBe("tool-1");
    expect((segments[0].items[1] as { id: string }).id).toBe("tool-2");
  });

  it("keeps activity together within a 5000ms idle gap", () => {
    const segments = segmentTurnItems([
      createToolActivity({
        id: "tool-1",
        toolName: "read",
        summary:
          'read {"path":"src/components/chat/ConversationView.tsx","limit":120}',
        createdAt: "2026-04-22T09:00:00.000Z",
      }),
      createToolActivity({
        id: "tool-2",
        toolName: "read",
        summary:
          'read {"path":"src/components/chat/ToolActivityGroup.tsx","limit":120}',
        createdAt: "2026-04-22T09:00:02.000Z",
      }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      type: "activity",
      activityPhase: "reading-files",
    });
  });

  it("keeps activity together even after an idle gap", () => {
    const segments = segmentTurnItems([
      createToolActivity({
        id: "tool-1",
        toolName: "read",
        summary:
          'read {"path":"src/components/chat/ConversationView.tsx","limit":120}',
        createdAt: "2026-04-22T09:00:00.000Z",
      }),
      createToolActivity({
        id: "tool-2",
        toolName: "read",
        summary:
          'read {"path":"src/components/chat/ToolActivityGroup.tsx","limit":120}',
        createdAt: "2026-04-22T09:00:06.000Z",
      }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      type: "activity",
      activityPhase: "reading-files",
    });
  });

  it("splits activity when assistant text appears between tool calls", () => {
    const segments = segmentTurnItems([
      createToolActivity({
        id: "tool-1",
        toolName: "read",
        summary:
          'read {"path":"src/components/chat/ConversationView.tsx","limit":120}',
        createdAt: "2026-04-22T09:00:00.000Z",
      }),
      {
        id: "assistant-1",
        kind: "assistant-message",
        content: "I found the relevant renderer.",
        createdAt: "2026-04-22T09:00:01.000Z",
      },
      createToolActivity({
        id: "tool-2",
        toolName: "apply_patch",
        summary:
          'apply_patch "*** Update File: src/components/chat/ToolActivityGroup.tsx"',
        createdAt: "2026-04-22T09:00:02.000Z",
      }),
    ]);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      type: "activity",
      activityPhase: "reading-files",
    });
    expect(segments[1]).toMatchObject({
      type: "text",
    });
    expect(segments[2]).toMatchObject({
      type: "activity",
      activityPhase: "writing-files",
    });
  });

  it("keeps earlier activity groups and appends live thinking at the end", () => {
    const segments = segmentTurnItems(
      [
        createToolActivity({
          id: "tool-1",
          summary:
            'apply_patch "*** Update File: src/components/chat/chatRuntime.ts"',
          createdAt: "2026-04-22T09:00:00.000Z",
          status: "completed",
          toolName: "apply_patch",
        }),
        createToolActivity({
          id: "tool-2",
          toolName: "read",
          summary:
            'read {"path":"src/components/chat/chatRuntime.ts","limit":120}',
          createdAt: "2026-04-22T09:00:00.700Z",
          status: "completed",
        }),
      ],
      {
        livePhase: {
          phase: "thinking",
          label: "thinking",
        },
      },
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      type: "activity",
      activityPhase: "reading-files",
    });
    expect(segments[1]).toMatchObject({
      type: "activity",
      activityPhase: "thinking",
      isLive: true,
      livePhase: { phase: "thinking", label: "thinking" },
    });
  });

  it("keeps the current activity phase live until another phase appears", () => {
    const segments = segmentTurnItems(
      [
        createToolActivity({
          id: "tool-1",
          toolName: "read",
          summary:
            'read {"path":"src/components/chat/ConversationView.tsx","limit":120}',
          createdAt: "2026-04-22T09:00:00.000Z",
          status: "completed",
        }),
      ],
      {
        livePhase: {
          phase: "reading-files",
          label: "reading files",
        },
      },
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      type: "activity",
      activityPhase: "reading-files",
      isLive: true,
      livePhase: { phase: "reading-files", label: "reading files" },
    });
  });
});

function createToolActivity(options: {
  id: string;
  createdAt: string;
  toolName?: string;
  summary: string;
  status?: "running" | "completed" | "failed";
}) {
  return {
    id: options.id,
    kind: "tool-activity" as const,
    createdAt: options.createdAt,
    activity: {
      id: options.id,
      toolName: options.toolName ?? "bash",
      summary: options.summary,
      status: options.status ?? "completed",
      startedAt: options.createdAt,
    },
  };
}
