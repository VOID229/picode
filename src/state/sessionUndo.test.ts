import { describe, expect, it } from "bun:test";
import type { PersistedAppState } from "../domains/types";
import { getUndoComposerDraft } from "./sessionUndo";

function createState(): PersistedAppState {
  return {
    schemaVersion: 3,
    activeWorkspaceId: "workspace-1",
    activeSessionId: "session-1",
    workspaces: [
      {
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
        sessions: [
          {
            id: "session-1",
            title: "New thread",
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
              lastKnownReady: true,
            },
            timeline: [
              {
                id: "user-1",
                kind: "user-message",
                createdAt: new Date().toISOString(),
                content: "undo me",
              },
              {
                id: "assistant-1",
                kind: "assistant-message",
                createdAt: new Date().toISOString(),
                content: "reply",
              },
            ],
          },
        ],
      },
    ],
    preferences: {
      theme: "dark",
      modelSelectionScope: "thread",
      threadModelMemory: "selected",
      providerId: "openai-codex",
      modelId: "gpt-5.4",
      effort: "high",
      approvalMode: "supervised",
      fastMode: false,
      titleModelProviderId: "openai-codex",
      titleModelId: "gpt-5.4-mini",
      titleModelFallbackProviderId: "openai-codex",
      titleModelFallbackId: "gpt-5.4",
      titleModelEffort: "high",
      autoTitleEnabled: true,
      autoGitMessagesEnabled: true,
      gitMessageModelProviderId: "openai-codex",
      gitMessageModelId: "gpt-5.4-mini",
      gitMessageModelFallbackProviderId: "openai-codex",
      gitMessageModelFallbackId: "gpt-5.4",
      gitMessageModelEffort: "high",
      showRawToolCalls: false,
      providerModelMemory: {},
      layout: {
        diffMode: "split",
        gitPanelOpen: false,
        diffPanelOpen: false,
      },
    },
    providers: [],
  };
}

describe("getUndoComposerDraft", () => {
  it("returns the selected user prompt", () => {
    expect(
      getUndoComposerDraft(createState(), "workspace-1", "session-1", "user-1"),
    ).toBe("undo me");
  });

  it("returns null when the prompt is missing", () => {
    expect(
      getUndoComposerDraft(
        createState(),
        "workspace-1",
        "session-1",
        "missing-user",
      ),
    ).toBeNull();
  });
});
