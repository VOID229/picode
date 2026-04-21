import { Copy, Download, MoreHorizontal, SquarePen } from "lucide-react";
import { useMemo, useState } from "react";
import { copyTextToClipboard } from "../../lib/clipboard";
import { writeTextFile } from "../../lib/tauri";
import { useAppStore } from "../../state/useAppStore";
import { ContextMenu, type ContextMenuItem } from "../layout/ContextMenu";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ActivityBlock } from "./ActivityBlock";

interface PlanCardProps {
  content: string;
  workspaceId: string;
  isActive?: boolean;
}

export function PlanCard({ content, workspaceId, isActive }: PlanCardProps) {
  const createSession = useAppStore((store) => store.createSession);
  const setComposerDraft = useAppStore((store) => store.setComposerDraft);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const menuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        label: "Copy as Markdown",
        icon: <Copy size={14} />,
        onClick: async () => {
          await copyTextToClipboard(content, "plan");
        },
      },
      {
        label: "Download as Markdown",
        icon: <Download size={14} />,
        onClick: async () => {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const path = await save({
            defaultPath: createDefaultPlanFilename(content),
            filters: [{ name: "Markdown", extensions: ["md"] }],
          });

          if (!path) {
            return;
          }

          await writeTextFile({ path, content });
        },
      },
      {
        label: "Send in New Chat",
        icon: <SquarePen size={14} />,
        separator: true,
        onClick: async () => {
          const sessionId = await createSession(workspaceId, {
            forceNew: true,
          });
          if (!sessionId) {
            return;
          }
          setComposerDraft(sessionId, content);
        },
      },
    ],
    [content, createSession, setComposerDraft, workspaceId],
  );

  return (
    <ActivityBlock
      title="Proposed Plan"
      icon={<SquarePen size={14} />}
      isActive={isActive}
    >
      <section className="plan-card" style={{ marginTop: 0, border: 'none', background: 'transparent' }}>
        <header className="plan-card__header" style={{ padding: '4px 0' }}>
          <div className="plan-card__eyebrow" style={{ visibility: 'hidden', height: 0, margin: 0 }}>Plan</div>
          <button
            className="plan-card__menu-button"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenuPosition({
                x: rect.right - 200,
                y: rect.bottom + 8,
              });
            }}
            type="button"
          >
            <MoreHorizontal size={16} />
          </button>
        </header>
        <div className="plan-card__body" style={{ padding: '0 0 12px 0' }}>
          <MarkdownRenderer className="markdown-content" content={content} />
        </div>
        {menuPosition && (
          <ContextMenu
            x={menuPosition.x}
            y={menuPosition.y}
            items={menuItems}
            onClose={() => setMenuPosition(null)}
          />
        )}
      </section>
    </ActivityBlock>
  );
}

function createDefaultPlanFilename(content: string) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const base = (heading || "plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "plan"}.md`;
}
