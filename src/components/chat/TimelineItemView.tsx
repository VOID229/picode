import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  Search,
  TerminalSquare,
  Wrench,
  XCircle,
} from "lucide-react";
import type { TimelineItem } from "../../domains/types";
import { cn } from "../../lib/cn";

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

  if (item.kind === "user-message") {
    return (
      <article className="chat-row chat-row--user animate-slide-up">
        <div className="chat-bubble chat-bubble--user">{item.content}</div>
      </article>
    );
  }

  if (item.kind === "assistant-message") {
    return (
      <article className="chat-row chat-row--assistant animate-slide-up">
        <div className="chat-assistant-copy">
          <div className="chat-copy-text">{item.content}</div>
          {item.streaming && (
            <div className="chat-inline-status">
              <LoaderCircle size={14} className="chat-inline-status__spin" />
              <span>Writing response</span>
            </div>
          )}
        </div>
      </article>
    );
  }

  if (item.kind === "tool-activity") {
    const isSearchTool =
      item.activity.toolName.toLowerCase().includes("search") ||
      item.activity.toolName.toLowerCase().includes("find");
    return (
      <article className="chat-row chat-row--assistant animate-slide-up">
        <div className="chat-inline-status">
          {isSearchTool ? <Search size={14} /> : <Wrench size={14} />}
          <span>
            {isSearchTool ? "Searching" : "Running tool"}:{" "}
            {item.activity.toolName}
          </span>
          <span className="chat-inline-status__meta">
            {item.activity.summary}
          </span>
        </div>
      </article>
    );
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

  if (/compact/i.test(item.title)) {
    return <LoaderCircle size={14} className="chat-inline-status__spin" />;
  }

  if (/retry/i.test(item.title)) {
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
