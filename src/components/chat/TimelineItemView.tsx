import {
  AlertTriangle,
  CheckCircle2,
  GitCommitHorizontal,
  Wrench,
  XCircle,
  User,
  Bot
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
  const isUser = item.kind === "user-message";
  const isAssistant = item.kind === "assistant-message";

  if (item.kind === "system-notice" && item.title === "Session ready") {
    return null;
  }

  if (isAssistant && !item.content.trim() && !item.streaming) {
    return null;
  }

  return (
    <article className={cn(
      "message animate-slide-up",
      isUser && "message--user",
      isAssistant && "message--assistant"
    )}>
      <div className="message__header">
        {isUser ? <User size={14} /> : <Bot size={14} className="text-accent" />}
        <span>{isUser ? "You" : (isAssistant && item.streaming ? "Pi is typing..." : "Pi")}</span>
      </div>

      <div className="message__bubble">
        {renderContent(item, workspaceId, sessionId, onResolveApproval)}
      </div>
    </article>
  );
}

function renderContent(
  item: TimelineItem, 
  workspaceId: string, 
  sessionId: string,
  onResolveApproval: TimelineItemViewProps["onResolveApproval"]
) {
  switch (item.kind) {
    case "user-message":
    case "assistant-message": {
      return <div className="message__content">{item.content}</div>;
    }
    
    case "tool-activity":
      return (
        <div className="tool-activity">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '0.85rem', fontWeight: 600 }}>
            <Wrench size={14} className="text-success" />
            <span>{item.activity.toolName}</span>
            <span style={{ fontSize: '0.75rem', opacity: 0.5, fontWeight: 400 }}>{item.activity.status}</span>
          </div>
          <div className="message__content" style={{ fontSize: '0.9rem' }}>{item.activity.summary}</div>
          {item.activity.output && (
            <pre style={{ 
              marginTop: '12px', 
              padding: '12px', 
              background: 'rgba(0,0,0,0.2)', 
              borderRadius: '8px', 
              fontSize: '0.8rem',
              overflowX: 'auto'
            }}>
              {item.activity.output}
            </pre>
          )}
        </div>
      );

    case "approval-request":
      return (
        <div className="approval-request">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--warning)' }}>
            <AlertTriangle size={16} />
            <span style={{ fontWeight: 600 }}>{item.approval.title}</span>
            <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', padding: '2px 6px', border: '1px solid currentColor', borderRadius: '4px' }}>
              {item.approval.risk}
            </span>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>{item.approval.reason}</p>
          
          {item.approval.command && <pre style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', marginBottom: '12px' }}>{item.approval.command}</pre>}
          {item.approval.diffPreview && <pre style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', marginBottom: '12px' }}>{item.approval.diffPreview}</pre>}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="nav-item nav-item--active"
              style={{ width: 'auto', background: 'var(--accent)', color: 'white' }}
              onClick={() => onResolveApproval(workspaceId, sessionId, item.approval.id, "approved")}
            >
              Approve
            </button>
            <button
              className="nav-item"
              style={{ width: 'auto', border: '1px solid var(--line)' }}
              onClick={() => onResolveApproval(workspaceId, sessionId, item.approval.id, "rejected")}
            >
              Reject
            </button>
          </div>
        </div>
      );

    case "approval-resolution":
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.8 }}>
          {item.decision === "approved" ? (
            <CheckCircle2 size={16} className="text-success" />
          ) : (
            <XCircle size={16} className="text-danger" />
          )}
          <span style={{ fontWeight: 600 }}>{item.decision === "approved" ? "Approved" : "Rejected"}</span>
          <span style={{ fontSize: '0.9rem' }}>— {item.summary}</span>
        </div>
      );

    default: {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.6 }}>
          <GitCommitHorizontal size={16} />
          <span style={{ fontWeight: 500 }}>{item.title}</span>
          <span style={{ fontSize: '0.85rem' }}>{item.detail}</span>
        </div>
      );
    }
  }
}
