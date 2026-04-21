import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";

interface ActivityBlockProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  isActive?: boolean;
  defaultExpanded?: boolean;
}

export function ActivityBlock({
  title,
  icon,
  children,
  isActive,
  defaultExpanded = false,
}: ActivityBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="activity-block">
      <button
        className="activity-block__header"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={14}
          className={cn("activity-block__arrow", expanded && "activity-block__arrow--expanded")}
        />
        {icon && <span className="activity-block__icon">{icon}</span>}
        <span className={cn("activity-block__title", isActive && "text-shimmer")}>
          {title}
        </span>
      </button>
      <div
        className={cn(
          "activity-block__content",
          expanded && "activity-block__content--expanded"
        )}
      >
        <div className="activity-block__content-inner">
          {children}
        </div>
      </div>
    </div>
  );
}
