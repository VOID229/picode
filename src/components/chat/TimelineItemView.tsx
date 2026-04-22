import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  GitFork,
  LoaderCircle,
  RotateCcw,
  Search,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import type { TimelineItem } from "../../domains/types";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { copyTextToClipboard } from "../../lib/clipboard";
import { useAppStore } from "../../state/useAppStore";
import { ActivityBlock } from "./ActivityBlock";
import { ImageAttachmentGallery } from "./ImageAttachmentGallery";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PlanCard } from "./PlanCard";
import { isTransientTimelineItem, parseAssistantContent } from "./chatRuntime";

interface TimelineItemViewProps {
  item: TimelineItem;
  workspaceId: string;
  sessionId: string;
  onResolveApproval: (
    workspaceId: string,
    sessionId: string,
    approvalId: string,
    decision: "approved" | "rejected",
  ) => Promise<void>;
}

export function TimelineItemView({
  item,
  workspaceId,
  sessionId,
  onResolveApproval,
}: TimelineItemViewProps) {
  const [copyFeedbackVisible, setCopyFeedbackVisible] = useState(false);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  const showCopyFeedback = () => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }

    setCopyFeedbackVisible(true);
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedbackVisible(false);
      copyFeedbackTimerRef.current = null;
    }, 1500);
  };

  const createSession = useAppStore((store) => store.createSession);
  const setComposerDraft = useAppStore((store) => store.setComposerDraft);
  const setComposerImages = useAppStore((store) => store.setComposerImages);
  const undoUserTurn = useAppStore((store) => store.undoUserTurn);
  const git = useAppStore((store) => store.git[workspaceId]);

  if (item.kind === "system-notice" && item.title === "Session ready") {
    return null;
  }

  if (
    item.kind === "assistant-message" &&
    !item.content.trim() &&
    !item.streaming
  ) {
    return null;
  }

  if (isTransientTimelineItem(item)) {
    return null;
  }

  if (item.kind === "user-message") {
    return (
      <article className="chat-row chat-row--user animate-slide-up">
        <div className="chat-user-stack">
          {item.images && item.images.length > 0 && (
            <ImageAttachmentGallery images={item.images} align="end" />
          )}
          {item.content.trim() && (
            <div className="chat-bubble chat-bubble--user">{item.content}</div>
          )}
          <div className="chat-message-actions">
            <button
              className="chat-message-action"
              title="Copy"
              type="button"
              onClick={async () => {
                const copied = await copyTextToClipboard(item.content, "message");
                if (copied) {
                  showCopyFeedback();
                }
              }}
            >
              {copyFeedbackVisible ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button
              className="chat-message-action"
              title="Fork"
              type="button"
              onClick={async () => {
                const nextSessionId = await createSession(workspaceId, {
                  forceNew: true,
                });
                if (!nextSessionId) {
                  return;
                }
                setComposerDraft(nextSessionId, item.content);
                setComposerImages(
                  nextSessionId,
                  (item.images ?? []).map((image) => ({
                    id: crypto.randomUUID(),
                    ...image,
                  })),
                );
              }}
            >
              <GitFork size={13} />
            </button>
            <button
              className="chat-message-action"
              title="Undo"
              type="button"
              onClick={async () => {
                if (!git?.isRepo) {
                  window.alert(
                    "Undo is only available for git workspaces with a saved checkpoint for this turn.",
                  );
                  return;
                }

                const confirmed = window.confirm(
                  "Undo this message and everything after it? This restores the working tree and index to the saved checkpoint only if HEAD has not changed.",
                );
                if (!confirmed) {
                  return;
                }

                try {
                  await undoUserTurn(workspaceId, sessionId, item.id);
                } catch (error) {
                  window.alert(
                    error instanceof Error
                      ? error.message
                      : "Undo is unavailable for this message.",
                  );
                }
              }}
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
      </article>
    );
  }

  if (item.kind === "assistant-message") {
    return (
      <article className="chat-row chat-row--assistant animate-slide-up">
        <div className="chat-assistant-stack">
          <div className="chat-assistant-copy">
            <div className="chat-copy-text">
              {parseAssistantContent(item.content).map((block, index) => {
                if (block.type === "proposed-plan") {
                  return (
                    <PlanCard
                      key={`${item.id}-plan-${index}`}
                      content={block.content}
                      workspaceId={workspaceId}
                      isActive={item.streaming && !block.isClosed}
                    />
                  );
                }
                if (block.type === "thinking") {
                  return (
                    <ActivityBlock
                      key={`${item.id}-thinking-${index}`}
                      title="Thinking"
                      icon={
                        <LoaderCircle
                          size={14}
                          className={
                            item.streaming && !block.isClosed
                              ? "chat-inline-status__spin"
                              : ""
                          }
                        />
                      }
                      isActive={item.streaming && !block.isClosed}
                    >
                      <MarkdownRenderer
                        className="markdown-content markdown-content--thinking"
                        content={block.content}
                      />
                    </ActivityBlock>
                  );
                }
                return (
                  <MarkdownRenderer
                    key={`${item.id}-md-${index}`}
                    className="markdown-content"
                    content={block.content}
                  />
                );
              })}
            </div>
          </div>
          {!item.streaming && (
            <div className="chat-message-actions chat-message-actions--assistant">
              <button
                className="chat-message-action"
                title="Copy response"
                type="button"
                aria-label="Copy response"
                onClick={async () => {
                  const copied = await copyTextToClipboard(item.content, "response");
                  if (copied) {
                    showCopyFeedback();
                  }
                }}
              >
                {copyFeedbackVisible ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          )}
        </div>
      </article>
    );
  }

  // Tool activities are rendered by ToolActivityGroup in ConversationView
  if (item.kind === "tool-activity") {
    return null;
  }

  if (item.kind === "approval-request") {
    return (
      <article className="chat-row chat-row--assistant animate-slide-up">
        <div className="chat-approval">
          <div className="chat-inline-status">
            <AlertTriangle size={14} />
            <span>Awaiting approval</span>
            <span className="chat-inline-status__meta">
              {item.approval.title}
            </span>
          </div>
          <div className="chat-copy-text chat-copy-text--muted">
            {item.approval.reason}
          </div>
          {item.approval.command && (
            <pre className="chat-inline-code">{item.approval.command}</pre>
          )}
          {item.approval.diffPreview && (
            <pre className="chat-inline-code">{item.approval.diffPreview}</pre>
          )}
          <div className="chat-approval__actions">
            <button
              className="chat-approval__button chat-approval__button--approve"
              onClick={() =>
                onResolveApproval(
                  workspaceId,
                  sessionId,
                  item.approval.id,
                  "approved",
                )
              }
            >
              Approve
            </button>
            <button
              className="chat-approval__button"
              onClick={() =>
                onResolveApproval(
                  workspaceId,
                  sessionId,
                  item.approval.id,
                  "rejected",
                )
              }
            >
              Reject
            </button>
          </div>
        </div>
      </article>
    );
  }

  if (item.kind === "approval-resolution") {
    return (
      <article className="chat-row chat-row--assistant animate-slide-up">
        <div className="chat-inline-status">
          {item.decision === "approved" ? (
            <CheckCircle2 size={14} />
          ) : (
            <XCircle size={14} />
          )}
          <span>{item.decision === "approved" ? "Approved" : "Rejected"}</span>
          <span className="chat-inline-status__meta">{item.summary}</span>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "chat-row chat-row--assistant animate-slide-up",
        item.kind === "error" && "chat-row--error",
      )}
    >
      <div className="chat-inline-status">
        {iconForNotice(item)}
        <span>{labelForNotice(item)}</span>
        {item.detail && (
          <span className="chat-inline-status__meta">{item.detail}</span>
        )}
      </div>
    </article>
  );
}

function iconForNotice(
  item: Extract<TimelineItem, { kind: "warning" | "error" | "system-notice" }>,
) {
  if (item.kind === "error") {
    return <XCircle size={14} />;
  }

  if (/search/i.test(item.title)) {
    return <Search size={14} />;
  }

  if (/compact|retry/i.test(item.title)) {
    return <LoaderCircle size={14} className="chat-inline-status__spin" />;
  }

  return <TerminalSquare size={14} />;
}

function labelForNotice(
  item: Extract<TimelineItem, { kind: "warning" | "error" | "system-notice" }>,
) {
  if (item.kind === "error") {
    return "Runtime error";
  }

  if (/compact/i.test(item.title)) {
    return "Compacting";
  }

  if (/retry/i.test(item.title)) {
    return "Retrying";
  }

  if (/aborted/i.test(item.title)) {
    return "Stopped";
  }

  return item.title;
}
