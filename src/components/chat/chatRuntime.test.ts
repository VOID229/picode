import { describe, expect, it } from "bun:test";
import type {
  ChatSession,
  ProviderOption,
  WorkspaceRecord,
} from "../../domains/types";
import {
  deriveLivePhase,
  parseAssistantContent,
  resolveComposerCapabilities,
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
  it("supports codex fast mode with the full reasoning ladder", () => {
    expect(
      resolveComposerCapabilities({
        providers: defaultProviders,
        selection: {
          providerId: "openai-codex",
          modelId: "gpt-5.4",
          effort: "extra-high",
          fastMode: true,
        },
      }),
    ).toMatchObject({
      supportsFastMode: true,
      normalizedSelection: {
        effort: "extra-high",
        fastMode: true,
      },
    });
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

  it("does not include planning detail for the default thinking phase", () => {
    const session = createSession({
      status: "streaming",
    });

    expect(deriveLivePhase(session)).toMatchObject({
      phase: "thinking",
      label: "thinking",
    });
    expect(deriveLivePhase(session)?.detail).toBeUndefined();
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
});

describe("segmentTurnItems", () => {
  it("splits activity when the phase changes", () => {
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

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      type: "activity",
      activityPhase: "writing-files",
    });
    expect(segments[1]).toMatchObject({
      type: "activity",
      activityPhase: "reading-files",
    });
    expect((segments[0].items[0] as { id: string }).id).toBe("tool-1");
    expect((segments[1].items[0] as { id: string }).id).toBe("tool-2");
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

  it("splits activity after an idle gap over 5000ms", () => {
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

    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.type === "activity")).toBe(true);
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

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      type: "activity",
      activityPhase: "writing-files",
    });
    expect(segments[1]).toMatchObject({
      type: "activity",
      activityPhase: "reading-files",
    });
    expect(segments[2]).toMatchObject({
      type: "activity",
      activityPhase: "thinking",
      isLive: true,
      livePhase: { phase: "thinking", label: "thinking" },
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
