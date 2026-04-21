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
  shortenAssistantLabel,
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
      { type: "proposed-plan", content: "# Plan\n- item" },
      { type: "markdown", content: "Outro" },
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
});
