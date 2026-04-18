import { Columns2, Rows3 } from "lucide-react";
import type { GitSnapshot, WorkspaceRecord } from "../../domains/types";
import { useAppStore } from "../../state/useAppStore";

interface DiffViewerProps {
  workspace: WorkspaceRecord | null;
  snapshot?: GitSnapshot;
}

export function DiffViewer({ workspace, snapshot }: DiffViewerProps) {
  const preferences = useAppStore((state) => state.state?.preferences);
  const updatePreferences = useAppStore((state) => state.updatePreferences);

  if (!workspace || !preferences) {
    return (
      <section className="rail-panel">
        <header className="rail-panel__header">
          <h2>Diff</h2>
        </header>
        <p className="rail-panel__empty">
          Diffs appear once Pi proposes or applies file changes.
        </p>
      </section>
    );
  }

  const firstFile = snapshot?.files[0];

  return (
    <section className="rail-panel">
      <header className="rail-panel__header">
        <h2>Diff</h2>
        <div className="rail-panel__actions">
          <button
            className="icon-link"
            type="button"
            aria-label="Split diff"
            onClick={() =>
              void updatePreferences({
                ...preferences,
                layout: { ...preferences.layout, diffMode: "split" },
              })
            }
          >
            <Columns2 size={15} />
          </button>
          <button
            className="icon-link"
            type="button"
            aria-label="Inline diff"
            onClick={() =>
              void updatePreferences({
                ...preferences,
                layout: { ...preferences.layout, diffMode: "inline" },
              })
            }
          >
            <Rows3 size={15} />
          </button>
        </div>
      </header>
      {firstFile ? (
        <div className="diff-viewer">
          <div className="diff-viewer__meta">
            <strong>{firstFile.path}</strong>
            <span>
              +{firstFile.additions} / -{firstFile.deletions}
            </span>
          </div>
          <pre>{firstFile.patch}</pre>
        </div>
      ) : (
        <p className="rail-panel__empty">
          No proposed file changes in this workspace yet.
        </p>
      )}
    </section>
  );
}
