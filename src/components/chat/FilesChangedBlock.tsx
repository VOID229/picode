import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import type { FileChange } from "./chatRuntime";
import type { DiffFile } from "../../domains/types";

interface FilesChangedBlockProps {
  /** File changes extracted from tool activities */
  toolFileChanges: FileChange[];
  /** Git-sourced diff files (preferred when available) */
  gitFiles?: DiffFile[];
  onUndo?: () => void;
  onRedo?: () => void;
  onClose?: () => void;
}

interface DisplayFile {
  path: string;
  additions: number;
  deletions: number;
}

function formatLineDelta(count: number) {
  return `${count}`;
}

export function FilesChangedBlock({
  toolFileChanges,
  gitFiles,
  onUndo,
  onRedo,
  onClose,
}: FilesChangedBlockProps) {
  const [expanded, setExpanded] = useState(true);

  // Prefer git data when available, fallback to tool-parsed data
  const files: DisplayFile[] =
    gitFiles && gitFiles.length > 0
      ? gitFiles.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
        }))
      : toolFileChanges;

  if (files.length === 0) return null;

  const totalFiles = files.length;

  return (
    <div className="files-changed-block">
      <div className="files-changed-block__header">
        <button
          className="files-changed-block__toggle"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="files-changed-block__count">
            {totalFiles} file{totalFiles !== 1 ? "s" : ""} changed
          </span>
          <ChevronDown
            size={14}
            className={cn(
              "files-changed-block__arrow",
              !expanded && "files-changed-block__arrow--collapsed",
            )}
          />
        </button>

        <div className="files-changed-block__actions">
          {onUndo && (
            <button
              className="files-changed-block__undo"
              onClick={onUndo}
              title="Undo changes"
            >
              Undo
            </button>
          )}
          {onRedo && (
            <button
              className="files-changed-block__undo"
              onClick={onRedo}
              title="Redo changes"
            >
              Redo
            </button>
          )}
          {onClose && (
            <button
              className="files-changed-block__undo"
              onClick={onClose}
              title="Close"
              aria-label="Close redo prompt"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div
        className={cn(
          "files-changed-block__content",
          expanded && "files-changed-block__content--expanded",
        )}
      >
        <div className="files-changed-block__list">
          {files.map((file) => (
            <div key={file.path} className="files-changed-block__file">
              <span className="files-changed-block__path">{file.path}</span>
              <span className="files-changed-block__stats">
                {file.additions > 0 && (
                  <span className="files-changed-block__additions">
                    +{formatLineDelta(file.additions)}
                  </span>
                )}
                {file.deletions > 0 && (
                  <span className="files-changed-block__deletions">
                    -{formatLineDelta(file.deletions)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
