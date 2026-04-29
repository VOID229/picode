import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { TimelineItem } from "../../domains/types";
import { cn } from "../../lib/cn";
import { useAppStore } from "../../state/useAppStore";
import type { ActivitySegment } from "./chatRuntime";
import {
  deriveCompactToolState,
  formatCompactGroupLabel,
  formatCompactGroupLabelRunning,
  formatCompactLiveLabel,
  formatCompactSummary,
  groupCompactToolItems,
  type CompactToolItem,
  type CompactToolItemType,
} from "./chatRuntime";

interface ToolActivityGroupProps {
  segment: ActivitySegment;
}

export function ToolActivityGroup({ segment }: ToolActivityGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);
  const showRawToolCalls = useAppStore(
    (store) => store.state?.preferences.showRawToolCalls ?? false,
  );

  const state = deriveCompactToolState(segment);
  const isLive = Boolean(segment.isLive);
  const isRunningPhase = state.phase === "running";
  const hasItems = state.items.length > 0;

  // Only commands can be expanded while live; done state is always expandable
  const canExpand =
    (isLive && isRunningPhase && hasItems) || (!isLive && hasItems);

  // Collect notice items for fallback rendering
  const noticeItems = segment.items.filter(
    (
      item,
    ): item is TimelineItem & {
      kind: "system-notice" | "warning";
      title: string;
      detail: string;
    } => item.kind === "system-notice" || item.kind === "warning",
  );

  if (state.items.length === 0 && noticeItems.length === 0) {
    return null;
  }

  const headerLabel = isLive
    ? formatCompactLiveLabel(state.phase)
    : formatCompactSummary(state.items);

  const grouped = groupCompactToolItems(state.items);

  return (
    <div className="tool-activity-group">
      {canExpand ? (
        <button
          className="tool-activity-group__header"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRight
            size={14}
            className={cn(
              "tool-activity-group__arrow",
              expanded && "tool-activity-group__arrow--expanded",
            )}
          />
          <span
            className={cn(
              "tool-activity-group__label",
              isLive && "tool-live-text",
            )}
          >
            {headerLabel}
          </span>
        </button>
      ) : (
        <div className="tool-activity-group__header tool-activity-group__header--static">
          <span
            className={cn(
              "tool-activity-group__label",
              isLive && "tool-live-text",
            )}
          >
            {headerLabel}
          </span>
        </div>
      )}

      {canExpand && (
        <div
          className={cn(
            "tool-activity-group__content",
            expanded && "tool-activity-group__content--expanded",
          )}
        >
          <div className="tool-activity-group__list">
            {isLive && isRunningPhase ? (
              <RunningCommandList items={state.items} />
            ) : (
              <DoneToolList grouped={grouped} />
            )}

            {noticeItems.length > 0 && state.items.length === 0 && (
              <div className="tool-activity-group__notices">
                {noticeItems.map((item) => (
                  <div key={item.id} className="tool-activity-group__notice">
                    <span className="tool-activity-group__notice-title">
                      {item.title}
                    </span>
                    {item.detail && (
                      <span className="tool-activity-group__notice-detail">
                        {item.detail}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {showRawToolCalls && state.items.length > 0 && (
            <div className="tool-activity-group__subsection">
              <button
                className="tool-activity-group__subtoggle"
                type="button"
                onClick={() => setRawExpanded((current) => !current)}
              >
                {rawExpanded ? "Hide raw tool calls" : "Show raw tool calls"}
              </button>
              {rawExpanded && (
                <div className="tool-activity-group__raw-list">
                  {state.items.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "tool-activity-group__raw-item",
                        item.status === "running" &&
                          "tool-activity-group__raw-item--running",
                      )}
                    >
                      <span className="tool-activity-group__raw-name">
                        {item.raw.activity.toolName}
                      </span>
                      <span className="tool-activity-group__raw-summary">
                        {item.raw.activity.summary}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunningCommandList({ items }: { items: CompactToolItem[] }) {
  const commandItems = items.filter((item) => item.type === "command");
  if (commandItems.length === 0) {
    return (
      <div className="tool-activity-group__empty">No commands running.</div>
    );
  }

  return (
    <div className="tool-activity-group__group">
      <div className="tool-activity-group__group-title">
        {formatCompactGroupLabelRunning("command")}
      </div>
      <ul className="tool-activity-group__group-list">
        {commandItems.map((item) => (
          <li key={item.id} className="tool-activity-group__group-row">
            <span className="tool-activity-group__group-label">
              {item.label}
            </span>
            <span className="tool-activity-group__group-status">
              {item.status === "running"
                ? "running…"
                : item.status === "error"
                  ? "✗"
                  : "✓"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DoneToolList({
  grouped,
}: {
  grouped: Record<CompactToolItemType, CompactToolItem[]>;
}) {
  const order: CompactToolItemType[] = ["read", "edit", "command", "search", "other"];
  const hasAny = order.some((type) => grouped[type].length > 0);

  if (!hasAny) {
    return (
      <div className="tool-activity-group__empty">
        No tool details captured.
      </div>
    );
  }

  return (
    <>
      {order.map((type) => {
        const groupItems = grouped[type];
        if (groupItems.length === 0) return null;
        return (
          <div key={type} className="tool-activity-group__group">
            <div className="tool-activity-group__group-title">
              {formatCompactGroupLabel(type)}
            </div>
            <ul className="tool-activity-group__group-list">
              {groupItems.map((item) => (
                <li key={item.id} className="tool-activity-group__group-row">
                  <span className="tool-activity-group__group-label">
                    {item.label}
                  </span>
                  <span className="tool-activity-group__group-status">
                    {item.status === "error" ? "✗" : "✓"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
