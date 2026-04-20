import { Copy, Download, MoreHorizontal, SquarePen } from "lucide-react";
import { useMemo, useState } from "react";
import { writeTextFile } from "../../lib/tauri";
import { useAppStore } from "../../state/useAppStore";
import { ContextMenu, type ContextMenuItem } from "../layout/ContextMenu";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface PlanCardProps {
  content: string;
  workspaceId: string;
}

export function PlanCard({ content, workspaceId }: PlanCardProps) {
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
          const { writeText } =
            await import("@tauri-apps/plugin-clipboard-manager");
          await writeText(content);
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
    <section className="plan-card">
      <header className="plan-card__header">
        <div className="plan-card__eyebrow">Plan</div>
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
      <div className="plan-card__body">
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
