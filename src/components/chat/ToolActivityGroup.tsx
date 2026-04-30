import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Code2,
  FileText,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ActivitySegment } from "./chatRuntime";
import {
  compactItemList,
  deriveCompactToolState,
  groupCompactToolItems,
  type CompactToolItem,
  type CompactToolItemType,
} from "./chatRuntime";
import { cn } from "../../lib/cn";

// ── Phase metadata ──────────────────────────────────────────────

const PHASE_META: Record<
  CompactToolItemType,
  { icon: React.ElementType; color: string; label: string }
> = {
  read: { icon: FileText, color: "#60a5fa", label: "Reading" },
  edit: { icon: Wrench, color: "#f59e0b", label: "Editing" },
  command: { icon: Terminal, color: "#a78bfa", label: "Running" },
  search: { icon: Search, color: "#34d399", label: "Searching" },
  other: { icon: Code2, color: "#9ca3af", label: "Working" },
};

const GROUP_ORDER: CompactToolItemType[] = [
  "edit",
  "read",
  "command",
  "search",
  "other",
];

// ── Consolidated segment logic ──────────────────────────────────

/**
 * Merge all activity segments from a turn into one unified view.
 * Instead of showing "read files" → "edit files" → "read files" as
 * separate blocks, we consolidate them into a single ActivityStream.
 */
export function useConsolidatedActivity(segments: ActivitySegment[]) {
  return useMemo(() => {
    const allItems: CompactToolItem[] = [];
    let isLive = false;
    let liveLabel = "Working…";
    let liveDetail: string | undefined;

    for (const seg of segments) {
      if (seg.isLive) {
        isLive = true;
        liveLabel = seg.livePhase?.label ?? "Working…";
        liveDetail = seg.livePhase?.detail;
      }
      const state = deriveCompactToolState(seg);
      allItems.push(...state.items);
    }

    // Deduplicate items by label (same file read/written multiple times)
    const seen = new Set<string>();
    const deduped: CompactToolItem[] = [];
    for (const item of allItems) {
      const key = `${item.type}:${item.label}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }

    // Group by type
    const grouped = groupCompactToolItems(deduped);

    // Build summary counts
    const counts: Record<string, number> = {};
    for (const type of GROUP_ORDER) {
      if (grouped[type].length > 0) {
        counts[type] = grouped[type].length;
      }
    }

    const totalCount = deduped.length;

    return {
      isLive,
      liveLabel,
      liveDetail,
      totalCount,
      counts,
      grouped,
      items: deduped,
    };
  }, [segments]);
}

// ── Animated dot component ──────────────────────────────────────

function PulseDot({
  color = "#3b82f6",
  size = 8,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <span
      className="activity-stream__pulse-wrap"
      style={{ width: size, height: size }}
    >
      <span
        className="activity-stream__pulse-dot"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
        }}
      />
      <span
        className="activity-stream__pulse-ring"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          borderColor: color,
        }}
      />
    </span>
  );
}

// ── Staggered list item ─────────────────────────────────────────

function StaggeredItem({
  item,
  index,
}: {
  item: CompactToolItem;
  index: number;
}) {
  const meta = PHASE_META[item.type];
  const Icon = meta.icon;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), index * 40);
    return () => clearTimeout(timer);
  }, [index]);

  const statusIcon =
    item.status === "success" ? (
      <CheckCircle2
        size={10}
        className="activity-stream__item-status activity-stream__item-status--success"
      />
    ) : item.status === "error" ? (
      <span className="activity-stream__item-status activity-stream__item-status--error">
        !
      </span>
    ) : (
      <span className="activity-stream__item-status activity-stream__item-status--running" />
    );

  return (
    <div
      className={cn(
        "activity-stream__item",
        visible && "activity-stream__item--visible",
      )}
      style={{ transitionDelay: `${index * 40}ms` }}
    >
      <Icon size={12} style={{ color: meta.color, flexShrink: 0 }} />
      <span className="activity-stream__item-label" title={item.label}>
        {item.label}
      </span>
      {statusIcon}
    </div>
  );
}

// ── Main ActivityStream component ───────────────────────────────

interface ActivityStreamProps {
  segments: ActivitySegment[];
}

export function ActivityStream({ segments }: ActivityStreamProps) {
  const { isLive, liveLabel, liveDetail, totalCount, counts, grouped, items } =
    useConsolidatedActivity(segments);
  const [expanded, setExpanded] = useState(false);

  if (totalCount === 0 && !isLive) return null;

  // Build compact summary text: "Edited 3 · Read 12 · Ran 2"
  const summaryParts: string[] = [];
  for (const type of GROUP_ORDER) {
    const n = counts[type];
    if (!n) continue;
    const shortLabel = PHASE_META[type].label.toLowerCase();
    summaryParts.push(`${shortLabel} ${n}`);
  }
  const summaryText = summaryParts.join(" · ") || `${totalCount} actions`;

  // ── Live state ──────────────────────────────────────────────
  if (isLive) {
    return (
      <div className="activity-stream activity-stream--live">
        <div className="activity-stream__live-header">
          <PulseDot color="var(--accent)" size={8} />
          <span className="activity-stream__live-label">{liveLabel}</span>
          {liveDetail && (
            <span className="activity-stream__live-detail" key={liveDetail}>
              {liveDetail}
            </span>
          )}
          {totalCount > 0 && (
            <span className="activity-stream__live-count">{totalCount}</span>
          )}
        </div>

        {/* Compact item trail — always visible, max 4 items */}
        {items.length > 0 && (
          <div className="activity-stream__live-trail">
            {items.slice(-4).map((item, i) => {
              const meta = PHASE_META[item.type];
              const Icon = meta.icon;
              return (
                <span
                  key={item.id}
                  className="activity-stream__live-trail-chip"
                  style={{
                    animationDelay: `${i * 60}ms`,
                  }}
                >
                  <Icon size={10} style={{ color: meta.color }} />
                  <span className="activity-stream__live-trail-label">
                    {item.label}
                  </span>
                </span>
              );
            })}
            {items.length > 4 && (
              <span className="activity-stream__live-trail-more">
                +{items.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Shimmer bar at bottom */}
        <div className="activity-stream__shimmer" />
      </div>
    );
  }

  // ── Completed state ─────────────────────────────────────────
  return (
    <div className="activity-stream activity-stream--done">
      <button
        className="activity-stream__summary"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <CheckCircle2 size={14} className="activity-stream__summary-icon" />
        <span className="activity-stream__summary-text">{summaryText}</span>
        <ChevronDown
          size={13}
          className={cn(
            "activity-stream__summary-chevron",
            expanded && "activity-stream__summary-chevron--open",
          )}
        />
      </button>

      {/* Expandable detail panel */}
      <div
        className={cn(
          "activity-stream__details",
          expanded && "activity-stream__details--open",
        )}
      >
        <div className="activity-stream__details-inner">
          {GROUP_ORDER.map((type) => {
            const groupItems = grouped[type];
            if (groupItems.length === 0) return null;
            const { visible, hiddenCount } = compactItemList(groupItems, 8);
            const meta = PHASE_META[type];
            const Icon = meta.icon;

            return (
              <div key={type} className="activity-stream__group">
                <div className="activity-stream__group-header">
                  <Icon size={11} style={{ color: meta.color }} />
                  <span className="activity-stream__group-label">
                    {meta.label}
                  </span>
                  <span className="activity-stream__group-count">
                    {groupItems.length}
                  </span>
                </div>
                <div className="activity-stream__group-items">
                  {visible.map((item, i) => (
                    <StaggeredItem key={item.id} item={item} index={i} />
                  ))}
                  {hiddenCount > 0 && (
                    <span className="activity-stream__more">
                      +{hiddenCount} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Backwards-compatible wrapper for single-segment usage ───────

interface ActivityFeedProps {
  segment: ActivitySegment;
}

export function ActivityFeed({ segment }: ActivityFeedProps) {
  return <ActivityStream segments={[segment]} />;
}
