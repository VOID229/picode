import { RefreshCcw } from "lucide-react";
import type { GitSnapshot, WorkspaceRecord } from "../../domains/types";
import { useAppStore } from "../../state/useAppStore";

interface GitPanelProps {
  workspace: WorkspaceRecord | null;
  snapshot?: GitSnapshot;
}

export function GitPanel({ workspace, snapshot }: GitPanelProps) {
  const refresh = useAppStore((state) => state.refreshGit);

  return (
    <section className="rail-panel">
      <header className="rail-panel__header">
        <h2>Git</h2>
        <button
          className="icon-link"
          type="button"
          aria-label="Refresh git status"
          disabled={!workspace}
          onClick={() => workspace && void refresh(workspace.id)}
        >
          <RefreshCcw size={15} />
        </button>
      </header>

      {!workspace ? (
        <p className="rail-panel__empty">
          Select a workspace to inspect branch and file state.
        </p>
      ) : !snapshot?.isRepo ? (
        <p className="rail-panel__empty">
          This workspace is not currently recognized as a git repository.
        </p>
      ) : (
        <div className="git-panel">
          <div className="git-panel__summary">
            <strong>{snapshot.branch}</strong>
            <span>{snapshot.summary}</span>
          </div>
          <div className="git-panel__counts">
            <span>{snapshot.dirty ? "Dirty" : "Clean"}</span>
            <span>{snapshot.stagedCount} staged</span>
            <span>{snapshot.unstagedCount} unstaged</span>
          </div>
          <ul className="git-panel__files">
            {snapshot.files.map((file) => (
              <li key={file.path}>
                <span>{file.path}</span>
                <small>{file.status}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
