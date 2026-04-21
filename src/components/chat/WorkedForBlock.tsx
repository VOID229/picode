import { ChevronRight, Clock } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";

interface WorkedForBlockProps {
  startTime: string;
  endTime: string;
  children: React.ReactNode;
}

function formatDuration(startIso: string, endIso: string): string {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const diffMs = Math.max(0, end - start);
  const totalSeconds = Math.round(diffMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function WorkedForBlock({
  startTime,
  endTime,
  children,
}: WorkedForBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const duration = formatDuration(startTime, endTime);

  return (
    <div className="worked-for-block">
      <button
        className="worked-for-block__header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="worked-for-block__label">
          Worked for {duration}
        </span>
        <ChevronRight
          size={12}
          className={cn(
            "worked-for-block__arrow",
            expanded && "worked-for-block__arrow--expanded",
          )}
        />
      </button>

      <div
        className={cn(
          "worked-for-block__content",
          expanded && "worked-for-block__content--expanded",
        )}
      >
        <div className="worked-for-block__content-inner">{children}</div>
      </div>
    </div>
  );
}
