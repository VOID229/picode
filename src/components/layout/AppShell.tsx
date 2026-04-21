import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openPath } from "../../lib/tauri";
import { useAppStore } from "../../state/useAppStore";
import { AddActionModal } from "../action/AddActionModal";
import { ConversationView } from "../chat/ConversationView";
import { CommandPalette } from "../command/CommandPalette";
import { Sidebar } from "../sidebar/Sidebar";
import { TerminalPane } from "../terminal/TerminalPane";
import { PromptModal } from "./PromptModal";
import {
  AppWindow,
  Bug,
  ChevronDown,
  CloudUpload,
  FlaskConical,
  Folder,
  GitCommit,
  GitCompare,
  GitPullRequest,
  Hammer,
  ListChecks,
  Play,
  Plus,
  Settings,
  SquareTerminal,
  Wrench,
} from "lucide-react";

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function AppShell() {
  const isBootstrapping = useAppStore((state) => state.isBootstrapping);
  const state = useAppStore((store) => store.state);
  const git = useAppStore((store) => store.git);
  const customActions = useAppStore((store) => store.customActions);
  const createSession = useAppStore((store) => store.createSession);
  const runtimeInstall = useAppStore((store) => store.runtimeInstall);
  const refreshWorkspaceRuntimeCatalog = useAppStore(
    (store) => store.refreshWorkspaceRuntimeCatalog,
  );
  const runTerminalCommand = useAppStore((store) => store.runTerminalCommand);
  const ensureTerminalSession = useAppStore(
    (store) => store.ensureTerminalSession,
  );
  const createTerminalTab = useAppStore((store) => store.createTerminalTab);
  const terminalPaneOpen = useAppStore((store) => store.terminalPaneOpen);
  const setTerminalPaneOpen = useAppStore((store) => store.setTerminalPaneOpen);
  const navigate = useNavigate();

  const [showActionModal, setShowActionModal] = useState(false);
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | undefined>();
  const [showGitDropdown, setShowGitDropdown] = useState(false);
  const [showOpenDropdown, setShowOpenDropdown] = useState(false);
  const [gitPromptMode, setGitPromptMode] = useState<
    null | "commit" | "commit-push"
  >(null);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        useAppStore.getState().setCommandPaletteOpen(true);
      }

      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        navigate("/settings");
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [navigate]);

  const activeWorkspace = useMemo(
    () =>
      state?.workspaces.find((item) => item.id === state.activeWorkspaceId) ??
      null,
    [state],
  );

  const activeSession = useMemo(
    () =>
      activeWorkspace?.sessions.find(
        (item) => item.id === state?.activeSessionId,
      ) ?? null,
    [activeWorkspace, state?.activeSessionId],
  );

  const activeWorkspaceActions = useMemo(
    () => (activeWorkspace ? (customActions[activeWorkspace.id] ?? []) : []),
    [activeWorkspace, customActions],
  );

  const gitSnapshot = activeWorkspace ? git[activeWorkspace.id] : undefined;
  const hasGit = Boolean(gitSnapshot?.isRepo);
  const deferredSession = useDeferredValue(activeSession);

  useEffect(() => {
    if (runtimeInstall?.status === "ready" && activeWorkspace) {
      void refreshWorkspaceRuntimeCatalog(activeWorkspace.id);
    }
  }, [
    activeWorkspace?.id,
    refreshWorkspaceRuntimeCatalog,
    runtimeInstall?.status,
  ]);

  const getIcon = (iconName: string, size = 14) => {
    switch (iconName) {
      case "Test":
        return <FlaskConical size={size} />;
      case "Lint":
        return <ListChecks size={size} />;
      case "Configure":
        return <Wrench size={size} />;
      case "Build":
        return <Hammer size={size} />;
      case "Debug":
        return <Bug size={size} />;
      case "Play":
      default:
        return <Play size={size} />;
    }
  };

  const runWorkspaceAction = async (command: string, refreshGit = false) => {
    if (!activeWorkspace) {
      return;
    }

    await runTerminalCommand(activeWorkspace.id, command, {
      openPane: true,
      refreshGit,
    });
  };

  const handlePrimaryOpen = async () => {
    if (!activeWorkspace) {
      return;
    }
    await openPath(activeWorkspace.path);
  };

  const handleTerminalToggle = async () => {
    const next = !terminalPaneOpen;
    setTerminalPaneOpen(next);
    if (next && activeWorkspace) {
      const terminalTabId =
        useAppStore.getState().terminals[activeWorkspace.id]?.activeTabId ??
        (await createTerminalTab(activeWorkspace.id));
      await ensureTerminalSession(activeWorkspace.id, terminalTabId);
    }
  };

  const handleCommitPrompt = async (message: string) => {
    if (!activeWorkspace) {
      return;
    }

    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const command =
      gitPromptMode === "commit-push"
        ? `git add -A && git commit -m ${shellQuote(trimmed)} && git push`
        : `git add -A && git commit -m ${shellQuote(trimmed)}`;

    setGitPromptMode(null);
    await runTerminalCommand(activeWorkspace.id, command, {
      openPane: true,
      refreshGit: true,
    });
  };

  if (isBootstrapping || !state) {
    return (
      <div className="boot-shell" aria-hidden="true">
        <div className="boot-shell__mark">picode</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar state={state} />

      <main className="main-pane" style={{ background: "var(--bg)" }}>
        <header
          className="main-pane__header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
            height: "54px",
            borderBottom: "none",
            background: "var(--bg)",
            backdropFilter: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span
              style={{ fontWeight: 600, fontSize: "0.9rem", color: "#fff" }}
            >
              {deferredSession ? deferredSession.title : "New thread"}
            </span>
            {activeWorkspace && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: "12px",
                  border: "1px solid #333",
                  fontSize: "0.75rem",
                  color: "#ccc",
                }}
              >
                {activeWorkspace.name}
              </span>
            )}
            {activeWorkspace && !hasGit && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: "12px",
                  border: "1px solid #4a3721",
                  fontSize: "0.75rem",
                  color: "#c59b6d",
                  background: "rgba(197,155,109,0.08)",
                }}
              >
                No Git
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {activeWorkspaceActions.length > 0 ? (
              <div style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <button
                    className="topbar-btn"
                    style={{
                      borderTopRightRadius: 0,
                      borderBottomRightRadius: 0,
                      borderRight: "none",
                    }}
                    title={activeWorkspaceActions[0].command}
                    onClick={() =>
                      void runWorkspaceAction(activeWorkspaceActions[0].command)
                    }
                  >
                    {getIcon(activeWorkspaceActions[0].icon)}
                    {activeWorkspaceActions[0].name}
                  </button>
                  <button
                    className="topbar-btn"
                    style={{
                      borderTopLeftRadius: 0,
                      borderBottomLeftRadius: 0,
                      padding: "6px 4px",
                    }}
                    onClick={() => setShowActionDropdown((value) => !value)}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                {showActionDropdown && (
                  <>
                    <div
                      className="click-away-layer"
                      onClick={() => setShowActionDropdown(false)}
                    />
                    <div className="app-shell__dropdown">
                      {activeWorkspaceActions.map((action) => (
                        <div
                          key={action.id}
                          className="dropdown-item group"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                          }}
                        >
                          <button
                            onClick={() => {
                              setShowActionDropdown(false);
                              void runWorkspaceAction(action.command);
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              flex: 1,
                              cursor: "pointer",
                              fontSize: "0.9rem",
                              textAlign: "left",
                              padding: 0,
                            }}
                          >
                            {getIcon(action.icon)}
                            <span style={{ flex: 1 }}>{action.name}</span>
                          </button>

                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditingActionId(action.id);
                              setShowActionModal(true);
                              setShowActionDropdown(false);
                            }}
                            title="Edit action"
                            className="edit-action-btn"
                          >
                            <Settings size={14} />
                          </button>
                        </div>
                      ))}
                      <div
                        style={{
                          height: "1px",
                          background: "#333",
                          margin: "6px 0",
                        }}
                      />
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setEditingActionId(undefined);
                          setShowActionModal(true);
                          setShowActionDropdown(false);
                        }}
                      >
                        <Plus size={14} /> Add action
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <button
                className="topbar-btn"
                onClick={() => {
                  setEditingActionId(undefined);
                  setShowActionModal(true);
                }}
              >
                <Plus size={14} /> Add action
              </button>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                position: "relative",
              }}
            >
              <button
                className="topbar-btn"
                style={{
                  borderTopRightRadius: 0,
                  borderBottomRightRadius: 0,
                  borderRight: "none",
                }}
                title="Open current directory"
                onClick={() => void handlePrimaryOpen()}
              >
                <AppWindow size={14} /> Open
              </button>
              <button
                className="topbar-btn"
                style={{
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  padding: "6px 4px",
                }}
                title="Change open target"
                onClick={() => setShowOpenDropdown((value) => !value)}
              >
                <ChevronDown size={14} />
              </button>

              {showOpenDropdown && activeWorkspace && (
                <>
                  <div
                    className="click-away-layer"
                    onClick={() => setShowOpenDropdown(false)}
                  />
                  <div
                    className="app-shell__dropdown"
                    style={{ minWidth: "180px" }}
                  >
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        setShowOpenDropdown(false);
                        void runTerminalCommand(
                          activeWorkspace.id,
                          `open -a Zed ${shellQuote(activeWorkspace.path)}`,
                          { openPane: false },
                        );
                      }}
                    >
                      <AppWindow size={14} />
                      <span style={{ flex: 1 }}>Zed</span>
                      <span style={{ fontSize: "0.7rem", color: "#666" }}>
                        ⌘O
                      </span>
                    </button>
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        setShowOpenDropdown(false);
                        void openPath(activeWorkspace.path);
                      }}
                    >
                      <Folder size={14} />
                      <span style={{ flex: 1 }}>Finder</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {!hasGit ? (
              <button
                className="topbar-btn"
                disabled={!activeWorkspace}
                onClick={() => {
                  if (activeWorkspace) {
                    void runTerminalCommand(activeWorkspace.id, "git init", {
                      openPane: true,
                      refreshGit: true,
                    });
                  }
                }}
              >
                Initialize Git
              </button>
            ) : (
              <div style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <button
                    className="topbar-btn"
                    style={{
                      borderTopRightRadius: 0,
                      borderBottomRightRadius: 0,
                      borderRight: "none",
                    }}
                    onClick={() => setGitPromptMode("commit-push")}
                  >
                    <CloudUpload size={14} /> Commit & push
                  </button>
                  <button
                    className="topbar-btn"
                    style={{
                      borderTopLeftRadius: 0,
                      borderBottomLeftRadius: 0,
                      padding: "6px 4px",
                    }}
                    onClick={() => setShowGitDropdown((value) => !value)}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                {showGitDropdown && activeWorkspace && (
                  <>
                    <div
                      className="click-away-layer"
                      onClick={() => setShowGitDropdown(false)}
                    />
                    <div
                      className="app-shell__dropdown"
                      style={{ minWidth: "170px" }}
                    >
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setShowGitDropdown(false);
                          setGitPromptMode("commit");
                        }}
                      >
                        <GitCommit size={14} /> Commit
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setShowGitDropdown(false);
                          void runTerminalCommand(
                            activeWorkspace.id,
                            "git push",
                            {
                              openPane: true,
                              refreshGit: true,
                            },
                          );
                        }}
                      >
                        <CloudUpload size={14} /> Push
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setShowGitDropdown(false);
                          void runTerminalCommand(
                            activeWorkspace.id,
                            "gh pr create --fill",
                            {
                              openPane: true,
                            },
                          );
                        }}
                      >
                        <GitPullRequest size={14} /> Create PR
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              className="topbar-btn icon-only"
              title="Terminal"
              onClick={() => void handleTerminalToggle()}
            >
              <SquareTerminal size={14} />
            </button>
            <button className="topbar-btn icon-only" title="Diff">
              <GitCompare size={14} />
            </button>
          </div>
        </header>

        <section
          className="conversation-view"
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            flex: 1,
          }}
        >
          <ConversationView
            workspace={activeWorkspace}
            session={deferredSession}
          />
          <TerminalPane workspace={activeWorkspace} />
        </section>
      </main>

      {showActionModal && activeWorkspace && (
        <AddActionModal
          workspaceId={activeWorkspace.id}
          editingActionId={editingActionId}
          onClose={() => {
            setShowActionModal(false);
            setEditingActionId(undefined);
          }}
        />
      )}

      {gitPromptMode && (
        <PromptModal
          title={
            gitPromptMode === "commit-push"
              ? "Commit message for commit and push"
              : "Commit message"
          }
          onConfirm={(value) => {
            void handleCommitPrompt(value);
          }}
          onCancel={() => setGitPromptMode(null)}
        />
      )}

      <CommandPalette />

      <style>{`
        .topbar-btn {
          background: transparent;
          border: 1px solid #333;
          color: #ccc;
          border-radius: 6px;
          padding: 0 10px;
          height: 28px;
          font-size: 0.8rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
          -webkit-app-region: no-drag;
        }
        .topbar-btn:hover {
          background: #222;
          color: #fff;
        }
        .topbar-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .icon-only {
          padding: 0;
          width: 28px;
        }
        .click-away-layer {
          position: fixed;
          inset: 0;
          z-index: 30;
        }
        .app-shell__dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 8px;
          background: #1c1c1e;
          border: 1px solid #333;
          border-radius: 12px;
          padding: 8px;
          min-width: 200px;
          z-index: 40;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .dropdown-item {
          background: transparent;
          border: none;
          color: #ccc;
          padding: 8px 12px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          font-size: 0.9rem;
          text-align: left;
        }
        .dropdown-item.group {
          cursor: default;
        }
        .dropdown-item:hover {
          background: #2a2a2c;
          color: white;
        }
        .dropdown-item.group .edit-action-btn {
          opacity: 0;
          background: transparent;
          border: none;
          color: #ccc;
          border-radius: 6px;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
          transition: opacity 0.1s ease, background 0.1s ease, color 0.1s ease;
        }
        .dropdown-item.group:hover .edit-action-btn {
          opacity: 1;
        }
        .dropdown-item.group .edit-action-btn:hover {
          background: rgba(255,255,255,0.15) !important;
          color: #fff !important;
        }
      `}</style>
    </div>
  );
}
