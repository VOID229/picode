import type { PersistedAppState } from "../domains/types";

export function getUndoComposerDraft(
  state: PersistedAppState | null,
  workspaceId: string,
  sessionId: string,
  userMessageId: string,
): string | null {
  const session = state?.workspaces
    .find((workspace) => workspace.id === workspaceId)
    ?.sessions.find((entry) => entry.id === sessionId);

  const message = session?.timeline.find(
    (item) => item.kind === "user-message" && item.id === userMessageId,
  );

  return message?.kind === "user-message" ? message.content : null;
}
