import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { TimelineItem, ToolActivityItem } from "../../domains/types";
import { cn } from "../../lib/cn";
import { useAppStore } from "../../state/useAppStore";
import {
  formatActivityPhaseLabel,
  formatToolGroupLabel,
  groupToolActivities,
  summarizeToolActivityDetails,
  type ActivitySegment,
  type ToolFileAction,
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

  const toolItems = segment.items.filter(
    (item): item is ToolActivityItem => item.kind === "tool-activity",
  );
  const noticeItems = segment.items.filter(
    (
      item,
    ): item is TimelineItem & {
      kind: "system-notice" | "warning";
      title: string;
      detail: string;
    } => item.kind === "system-notice" || item.kind === "warning",
  );

  if (toolItems.length === 0 && noticeItems.length === 0) {
    return null;
  }

  const summary = groupToolActivities(toolItems);
  const details = summarizeToolActivityDetails(toolItems);
  const label =
    toolItems.length > 0
      ? formatToolGroupLabel(summary)
      : formatActivityPhaseLabel(segment.phase);
  const anyRunning = toolItems.some(
    (item) => item.activity.status === "running",
  );

  return (
    <div className="tool-activity-group">
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
            anyRunning && "text-shimmer",
          )}
        >
          {label}
        </span>
      </button>

      <div
        className={cn(
          "tool-activity-group__content",
          expanded && "tool-activity-group__content--expanded",
        )}
      >
        <div className="tool-activity-group__list">
          {details.files.length > 0 ? (
            details.files.map((file) => (
              <div key={file.path} className="tool-activity-group__file">
                <span
                  className="tool-activity-group__file-path"
                  title={file.path}
                >
                  {file.path}
                </span>
                <span className="tool-activity-group__file-actions">
                  {formatToolFileActions(file.actions)}
                </span>
              </div>
            ))
          ) : noticeItems.length > 0 ? (
            noticeItems.map((item) => (
              <div key={item.id} className="tool-activity-group__item">
                <span className="tool-activity-group__tool-name">
                  {item.title}
                </span>
                {item.detail && (
                  <span className="tool-activity-group__tool-summary">
                    {item.detail}
                  </span>
                )}
              </div>
            ))
          ) : (
            <div className="tool-activity-group__empty">
              No file paths captured for this step.
            </div>
          )}
        </div>
        {showRawToolCalls && details.rawCalls.length > 0 && (
          <div className="tool-activity-group__subsection">
            <button
              className="tool-activity-group__subtoggle"
              type="button"
              onClick={() => setRawExpanded((current) => !current)}
            >
              {rawExpanded ? "Hide raw tool calls" : "Show raw tool calls"}
            </button>
            {rawExpanded && (
              <div className="tool-activity-group__list">
                {details.rawCalls.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "tool-activity-group__item",
                      item.activity.status === "running" &&
                        "tool-activity-group__item--running",
                    )}
                  >
                    <span className="tool-activity-group__tool-name">
                      {item.activity.toolName}
                    </span>
                    <span className="tool-activity-group__tool-summary">
                      {item.activity.summary}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatToolFileActions(actions: ToolFileAction[]) {
  return actions
    .map((action) => {
      switch (action) {
        case "edit":
          return "edited";
        case "search":
          return "searched";
        case "list":
          return "listed";
        case "read":
        default:
          return "read";
      }
    })
    .join(", ");
}
