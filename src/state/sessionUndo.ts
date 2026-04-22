import type {
  MessageImageAttachment,
  PersistedAppState,
} from "../domains/types";

export function getUndoComposerMessage(
  state: PersistedAppState | null,
  workspaceId: string,
  sessionId: string,
  userMessageId: string,
): { content: string; images: MessageImageAttachment[] } | null {
  const session = state?.workspaces
    .find((workspace) => workspace.id === workspaceId)
    ?.sessions.find((entry) => entry.id === sessionId);

  const message = session?.timeline.find(
    (item) => item.kind === "user-message" && item.id === userMessageId,
  );

  return message?.kind === "user-message"
    ? {
        content: message.content,
        images: message.images ?? [],
      }
    : null;
}

export function getUndoComposerDraft(
  state: PersistedAppState | null,
  workspaceId: string,
  sessionId: string,
  userMessageId: string,
): string | null {
  return (
    getUndoComposerMessage(state, workspaceId, sessionId, userMessageId)
      ?.content ?? null
  );
}
