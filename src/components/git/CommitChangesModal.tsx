import {
  Check,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  GitAction,
  PreparedGitAction,
  WorkspaceRecord,
} from "../../domains/types";
import { cn } from "../../lib/cn";
import { useAppStore } from "../../state/useAppStore";

interface CommitChangesModalProps {
  workspace: WorkspaceRecord;
  initialAction: GitAction;
  onClose: () => void;
}

const ACTIONS: Array<{
  id: GitAction;
  label: string;
  icon: ReactNode;
}> = [
  { id: "commit", label: "Commit", icon: <GitCommit size={19} /> },
  { id: "commit-push", label: "Commit & push", icon: <Upload size={20} /> },
  {
    id: "create-pr",
    label: "Commit & create PR",
    icon: <GitPullRequest size={19} />,
  },
];

export function CommitChangesModal({
  workspace,
  initialAction,
  onClose,
}: CommitChangesModalProps) {
  const prepareGitAction = useAppStore((store) => store.prepareGitAction);
  const runGitAction = useAppStore((store) => store.runGitAction);
  const addToast = useAppStore((store) => store.addToast);
  const [prepared, setPrepared] = useState<PreparedGitAction | null>(null);
  const [selectedAction, setSelectedAction] = useState<GitAction>(
    initialAction === "push" ? "push" : initialAction,
  );
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [message, setMessage] = useState("");
  const [autoGenerateMessage, setAutoGenerateMessage] = useState(false);
  const [showCustomInstructions, setShowCustomInstructions] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [draft, setDraft] = useState(initialAction === "create-pr");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void prepareGitAction({ workspaceId: workspace.id })
      .then((payload) => {
        if (!cancelled) {
          setPrepared(payload);
          setIncludeUnstaged(payload.hasUnstaged);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [prepareGitAction, workspace.id]);

  const normalizedAction = useMemo<GitAction>(() => {
    if (selectedAction === "push") {
      return "push";
    }
    return selectedAction;
  }, [selectedAction]);

  const canCreatePr = prepared?.canCreatePr ?? false;
  const hasChanges = Boolean(prepared?.hasStaged || prepared?.hasUnstaged);
  const commitFieldVisible = normalizedAction !== "push" && hasChanges;
  const commitMessageId = "git-commit-message";
  const customInstructionsId = "git-custom-instructions";

  const canSubmit =
    !error &&
    prepared &&
    (normalizedAction === "push" || hasChanges) &&
    (normalizedAction === "push" || autoGenerateMessage || message.trim().length > 0);

  const handleContinue = async () => {
    if (!canSubmit) return;

    const actionLabel =
      normalizedAction === "commit"
        ? "Committing"
        : normalizedAction === "commit-push"
          ? "Committing and pushing"
          : normalizedAction === "create-pr"
            ? "Creating PR"
            : "Pushing";

    onClose();
    addToast({ message: `${actionLabel}...`, type: "info" });

    try {
      const result = await runGitAction({
        workspaceId: workspace.id,
        action: normalizedAction,
        includeUnstaged,
        message: autoGenerateMessage ? message.trim() || undefined : message.trim(),
        customInstructions,
        draft,
      });

      if (result.prUrl) {
        addToast({
          message: `${result.summary}: ${result.prUrl}`,
          type: "success",
        });
      } else {
        addToast({
          message: result.summary,
          type: "success",
        });
      }
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : String(err),
        type: "error",
      });
    }
  };

  return (
    <div className="git-modal-backdrop" onClick={onClose}>
      <section
        className="git-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="git-modal__close"
          type="button"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={22} />
        </button>

        <div className="git-modal__mark">
          <GitCommit size={30} />
        </div>
        <h2>Commit your changes</h2>

        <div className="git-modal__row">
          <strong>Branch</strong>
          <span className="git-modal__meta">
            <GitBranch size={22} />
            {prepared?.branch ?? "loading"}
          </span>
        </div>

        <div className="git-modal__row">
          <strong>Changes</strong>
          <span className="git-modal__changes">
            <span>{prepared ? `${prepared.fileCount} files` : "..."}</span>
            <span className="git-modal__additions">
              +{prepared?.additions ?? 0}
            </span>
            <span className="git-modal__deletions">
              -{prepared?.deletions ?? 0}
            </span>
          </span>
        </div>

        {hasChanges && (
          <label className="git-modal__toggle-row">
            <span
              className={cn(
                "git-modal__switch",
                includeUnstaged && "git-modal__switch--on",
              )}
            >
              <input
                checked={includeUnstaged}
                type="checkbox"
                onChange={(event) => setIncludeUnstaged(event.target.checked)}
              />
              <span />
            </span>
            Include unstaged
          </label>
        )}

        {commitFieldVisible && (
          <>
            <label className="git-modal__toggle-row">
              <span
                className={cn(
                  "git-modal__switch",
                  autoGenerateMessage && "git-modal__switch--on",
                )}
              >
                <input
                  checked={autoGenerateMessage}
                  type="checkbox"
                  onChange={(event) =>
                    setAutoGenerateMessage(event.target.checked)
                  }
                />
                <span />
              </span>
              Auto-generate commit message
            </label>

            <div className="git-modal__field">
              <div className="git-modal__field-head">
                <label htmlFor={commitMessageId}>
                  {autoGenerateMessage
                    ? "Commit message (optional)"
                    : "Commit message"}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setShowCustomInstructions((current) => !current)
                  }
                >
                  Custom instructions
                </button>
              </div>
              <textarea
                id={commitMessageId}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={
                  autoGenerateMessage
                    ? "Leave blank to autogenerate a commit message"
                    : "Enter your commit message"
                }
                rows={2}
              />
            </div>
          </>
        )}

        {showCustomInstructions && (
          <div className="git-modal__field">
            <div className="git-modal__field-head">
              <label htmlFor={customInstructionsId}>Custom instructions</label>
            </div>
            <textarea
              id={customInstructionsId}
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              placeholder="Optional instructions for autogenerated commit or PR text"
              rows={2}
              autoFocus
            />
          </div>
        )}

        <div className="git-modal__steps">
          <strong>Next steps</strong>
          <div className="git-modal__step-list">
            {(selectedAction === "push"
              ? [
                  {
                    id: "push" as GitAction,
                    label: "Push",
                    icon: <Upload size={20} />,
                  },
                ]
              : ACTIONS
            ).map((action) => {
              const disabled = action.id === "create-pr" && !canCreatePr;
              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={disabled}
                  className={cn(
                    "git-modal__step",
                    selectedAction === action.id && "git-modal__step--selected",
                  )}
                  title={disabled ? prepared?.prUnavailableReason : undefined}
                  onClick={() => setSelectedAction(action.id)}
                >
                  {action.icon}
                  <span>{action.label}</span>
                  {selectedAction === action.id && <Check size={26} />}
                </button>
              );
            })}
          </div>
        </div>

        {(selectedAction === "create-pr" || initialAction === "create-pr") && (
          <label className="git-modal__draft">
            <span
              className={cn(
                "git-modal__switch git-modal__switch--small",
                draft && "git-modal__switch--on",
              )}
            >
              <input
                checked={draft}
                type="checkbox"
                onChange={(event) => setDraft(event.target.checked)}
              />
              <span />
            </span>
            Draft
          </label>
        )}

        {error && <p className="git-modal__error">{error}</p>}

        <div className="git-modal__footer">
          <button
            className="git-modal__continue"
            type="button"
            disabled={
              !canSubmit ||
              (selectedAction === "create-pr" && !canCreatePr)
            }
            onClick={() => void handleContinue()}
          >
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}
