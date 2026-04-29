import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import type { WorkspaceRecord } from "../../domains/types";
import {
  getShortcutBinding,
  matchesShortcut,
} from "../../lib/keyboardShortcuts";
import { openPath } from "../../lib/tauri";
import { useAppStore } from "../../state/useAppStore";
import { AddActionModal } from "../action/AddActionModal";
import { ConversationView } from "../chat/ConversationView";
import { CommandPalette } from "../command/CommandPalette";
import { CommitChangesModal } from "../git/CommitChangesModal";
import { Sidebar } from "../sidebar/Sidebar";
import { ProjectPicker } from "../sidebar/ProjectPicker";
import { TerminalPane } from "../terminal/TerminalPane";
import { ToastContainer } from "../layout/ToastContainer";
import type { GitAction } from "../../domains/types";
import {
  AppWindow,
  Bug,
  ChevronDown,
  CloudUpload,
  FlaskConical,
  Folder,
  GitCompare,
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

type OpenTarget = "zed" | "finder";

export function AppShell() {
  const isBootstrapping = useAppStore((state) => state.isBootstrapping);
  const state = useAppStore((store) => store.state);
  const git = useAppStore((store) => store.git);
  const customActions = useAppStore((store) => store.customActions);
  const createWorkspace = useAppStore((store) => store.createWorkspace);
  const createTerminalTab = useAppStore((store) => store.createTerminalTab);
  const closeTerminalTab = useAppStore((store) => store.closeTerminalTab);
  const runtimeInstall = useAppStore((store) => store.runtimeInstall);
  const refreshWorkspaceRuntimeCatalog = useAppStore(
    (store) => store.refreshWorkspaceRuntimeCatalog,
  );
  const runTerminalCommand = useAppStore((store) => store.runTerminalCommand);
  const initializeGitRepository = useAppStore(
    (store) => store.initializeGitRepository,
  );
  const refreshGit = useAppStore((store) => store.refreshGit);
  const terminalPaneOpen = useAppStore((store) => store.terminalPaneOpen);
  const setTerminalPaneOpen = useAppStore((store) => store.setTerminalPaneOpen);
  const navigate = useNavigate();
  const location = useLocation();
  const isSettings = location.pathname === "/settings";

  const [showActionModal, setShowActionModal] = useState(false);
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | undefined>();
  const [showGitDropdown, setShowGitDropdown] = useState(false);
  const [showOpenDropdown, setShowOpenDropdown] = useState(false);
  const [openTarget, setOpenTarget] = useState<OpenTarget>("zed");
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [gitActionMode, setGitActionMode] = useState<GitAction | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(276);
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(terminalHeight);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        matchesShortcut(
          event,
          getShortcutBinding(state?.preferences.shortcuts, "commandPalette"),
        )
      ) {
        event.preventDefault();
        useAppStore.getState().setCommandPaletteOpen(true);
      }

      if (
        matchesShortcut(
          event,
          getShortcutBinding(state?.preferences.shortcuts, "settings"),
        )
      ) {
        event.preventDefault();
        navigate("/settings");
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [navigate, state?.preferences.shortcuts]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startYRef.current - event.clientY;
      const nextHeight = Math.max(
        120,
        Math.min(window.innerHeight * 0.8, startHeightRef.current + delta),
      );
      setTerminalHeight(nextHeight);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

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
    if (activeWorkspace && git[activeWorkspace.id] === undefined) {
      void refreshGit(activeWorkspace.id);
    }
  }, [
    activeWorkspace?.id,
    refreshWorkspaceRuntimeCatalog,
    refreshGit,
    runtimeInstall?.status,
    git,
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

  const openWorkspace = async (
    workspace: WorkspaceRecord,
    target: OpenTarget,
  ) => {
    if (target === "zed") {
      await runTerminalCommand(
        workspace.id,
        `open -a Zed ${shellQuote(workspace.path)}`,
        { openPane: false },
      );
      return;
    }

    await openPath(workspace.path);
  };

  const handlePrimaryOpen = async () => {
    if (!activeWorkspace) {
      return;
    }
    await openWorkspace(activeWorkspace, openTarget);
  };

  const handleTerminalToggle = () => {
    setTerminalPaneOpen(!terminalPaneOpen);
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        matchesShortcut(
          event,
          getShortcutBinding(state?.preferences.shortcuts, "addProject"),
        )
      ) {
        event.preventDefault();
        setShowProjectPicker(true);
        return;
      }

      if (showProjectPicker) {
        return;
      }

      if (
        matchesShortcut(
          event,
          getShortcutBinding(state?.preferences.shortcuts, "openWorkspace"),
        )
      ) {
        event.preventDefault();
        void handlePrimaryOpen();
        return;
      }

      if (!activeWorkspace || !terminalPaneOpen) {
        return;
      }

      if (
        matchesShortcut(
          event,
          getShortcutBinding(state?.preferences.shortcuts, "newTerminalTab"),
        )
      ) {
        event.preventDefault();
        void createTerminalTab(activeWorkspace.id);
        return;
      }

      if (
        matchesShortcut(
          event,
          getShortcutBinding(state?.preferences.shortcuts, "closeTerminalTab"),
        )
      ) {
        const terminalTabId =
          useAppStore.getState().terminals[activeWorkspace.id]?.activeTabId;
        if (!terminalTabId) {
          return;
        }
        event.preventDefault();
        void closeTerminalTab(activeWorkspace.id, terminalTabId);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    activeWorkspace,
    closeTerminalTab,
    createTerminalTab,
    handlePrimaryOpen,
    showProjectPicker,
    state?.preferences.shortcuts,
    terminalPaneOpen,
  ]);

  if (isBootstrapping || !state) {
    return (
      <div className="boot-shell" aria-hidden="true">
        <div className="boot-shell__mark">picode</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {isSettings && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
          }}
        >
          <Outlet />
        </div>
      )}
      <Sidebar state={state} onAddProject={() => setShowProjectPicker(true)} />

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
              {deferredSession?.timeline.some(
                (item) => item.kind === "user-message",
              )
                ? deferredSession.title
                : deferredSession
                  ? "New thread"
                  : ""}
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
                        setOpenTarget("zed");
                        void openWorkspace(activeWorkspace, "zed");
                      }}
                    >
                      <ZedLogo size={14} />
                      <span style={{ flex: 1 }}>Zed</span>
                      <span style={{ fontSize: "0.7rem", color: "#666" }}>
                        ⌘O
                      </span>
                    </button>
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        setShowOpenDropdown(false);
                        setOpenTarget("finder");
                        void openWorkspace(activeWorkspace, "finder");
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
                    void initializeGitRepository(activeWorkspace.id);
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
                    onClick={() => setGitActionMode("commit-push")}
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
                          setGitActionMode("commit");
                        }}
                      >
                        <CloudUpload size={14} /> Commit
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setShowGitDropdown(false);
                          setGitActionMode("push");
                        }}
                      >
                        <CloudUpload size={14} /> Push
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setShowGitDropdown(false);
                          setGitActionMode("create-pr");
                        }}
                      >
                        <CloudUpload size={14} /> Create PR
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
          {terminalPaneOpen && (
            <div
              className="terminal-resize-handle"
              onMouseDown={(event) => {
                isResizingRef.current = true;
                startYRef.current = event.clientY;
                startHeightRef.current = terminalHeight;
                document.body.style.cursor = "row-resize";
                document.body.style.userSelect = "none";
              }}
            />
          )}
          <TerminalPane
            workspace={activeWorkspace}
            height={terminalHeight}
          />
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

      {gitActionMode && activeWorkspace && (
        <CommitChangesModal
          workspace={activeWorkspace}
          initialAction={gitActionMode}
          onClose={() => setGitActionMode(null)}
        />
      )}

      <CommandPalette />

      {showProjectPicker && (
        <ProjectPicker
          onClose={() => setShowProjectPicker(false)}
          onSelect={(path) => {
            void createWorkspace(path);
            setShowProjectPicker(false);
          }}
        />
      )}

      <ToastContainer />

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

function ZedLogo({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path
        fill="#ffff"
        fillRule="evenodd"
        d="M9 6a3 3 0 0 0-3 3v66H0V9a9 9 0 0 1 9-9h80.379c4.009 0 6.016 4.847 3.182 7.682L43.055 57.187H57V51h6v7.688a4.5 4.5 0 0 1-4.5 4.5H37.055L26.743 73.5H73.5V36h6v37.5a6 6 0 0 1-6 6H20.743L10.243 90H87a3 3 0 0 0 3-3V21h6v66a9 9 0 0 1-9 9H6.621c-4.009 0-6.016-4.847-3.182-7.682L52.757 39H39v6h-6v-7.5a4.5 4.5 0 0 1 4.5-4.5h21.257l10.5-10.5H22.5V60h-6V22.5a6 6 0 0 1 6-6h52.757L85.757 6H9Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
