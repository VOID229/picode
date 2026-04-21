import { ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";
import type { TimelineItem, ToolActivityItem } from "../../domains/types";
import { cn } from "../../lib/cn";
import {
  formatToolGroupLabel,
  groupToolActivities,
} from "./chatRuntime";

interface ToolActivityGroupProps {
  items: TimelineItem[];
  isStreaming?: boolean;
}

export function ToolActivityGroup({
  items,
  isStreaming,
}: ToolActivityGroupProps) {
  const [expanded, setExpanded] = useState(false);

  const toolItems = items.filter(
    (item): item is ToolActivityItem => item.kind === "tool-activity",
  );

  if (toolItems.length === 0) return null;

  const summary = groupToolActivities(toolItems);
  const label = formatToolGroupLabel(summary);
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
        <Wrench
          size={14}
          className={cn(
            "tool-activity-group__icon",
            (anyRunning || isStreaming) && "chat-inline-status__spin",
          )}
        />
        <span
          className={cn(
            "tool-activity-group__label",
            (anyRunning || isStreaming) && "text-shimmer",
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
          {toolItems.map((item) => (
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
      </div>
    </div>
  );
}
