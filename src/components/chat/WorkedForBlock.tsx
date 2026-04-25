import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";

interface WorkedForBlockProps {
  startTime: string;
  endTime?: string;
  isLive?: boolean;
  paused?: boolean;
  children: React.ReactNode;
}

const pauseStateByStart = new Map<
  string,
  { activeSince?: number; accumulatedMs: number }
>();

function resolvePauseAdjustedEnd(
  startIso: string,
  endIso: string,
  paused: boolean,
) {
  const end = new Date(endIso).getTime();
  const state = pauseStateByStart.get(startIso) ?? { accumulatedMs: 0 };

  if (paused && !state.activeSince) {
    state.activeSince = end;
  } else if (!paused && state.activeSince) {
    state.accumulatedMs += Math.max(0, end - state.activeSince);
    state.activeSince = undefined;
  }

  pauseStateByStart.set(startIso, state);
  return (
    end -
    state.accumulatedMs -
    (state.activeSince ? end - state.activeSince : 0)
  );
}

function formatDuration(
  startIso: string,
  endIso: string,
  paused: boolean,
): string {
  const start = new Date(startIso).getTime();
  const end = resolvePauseAdjustedEnd(startIso, endIso, paused);
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
  isLive = false,
  paused = false,
  children,
}: WorkedForBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => new Date().toISOString());
  const duration = formatDuration(startTime, endTime ?? now, paused);

  useEffect(() => {
    if (!isLive || endTime || paused) {
      return;
    }

    const interval = window.setInterval(() => {
      setNow(new Date().toISOString());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [endTime, isLive, paused]);

  return (
    <div className="worked-for-block">
      <button
        className="worked-for-block__header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="worked-for-block__label">
          {isLive && !endTime ? "working" : "worked"} for {duration}
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
