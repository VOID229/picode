import { useEffect, useMemo, useState } from "react";
import { useDeferredValue } from "react";
import { useNavigate } from "react-router-dom";
import { ConversationView } from "../chat/ConversationView";
import { CommandPalette } from "../command/CommandPalette";
import { Sidebar } from "../sidebar/Sidebar";
import { AddActionModal } from "../action/AddActionModal";
import { usePiBridge } from "../../services/piBridge";
import { useAppStore } from "../../state/useAppStore";
import { Plus, Play, ChevronDown, SquareTerminal, GitCompare, GitCommit, CloudUpload, GitPullRequest, AppWindow, Folder, FlaskConical, ListChecks, Wrench, Hammer, Bug, Settings } from "lucide-react";

export function AppShell() {
  const initialize = useAppStore((state) => state.initialize);
  const isBootstrapping = useAppStore((state) => state.isBootstrapping);
  const state = useAppStore((store) => store.state);
  const customActions = useAppStore((store) => store.customActions);
  const createSession = useAppStore((store) => store.createSession);
  const navigate = useNavigate();
  const [showActionModal, setShowActionModal] = useState(false);
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | undefined>(undefined);
  const [forceGitRef, setForceGitRef] = useState(false); // Local simulation
  const [showGitDropdown, setShowGitDropdown] = useState(false);
  const [showOpenDropdown, setShowOpenDropdown] = useState(false);

  usePiBridge();

  useEffect(() => {
    void initialize();
  }, [initialize]);

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
    () => (activeWorkspace ? customActions[activeWorkspace.id] ?? [] : []),
    [activeWorkspace, customActions]
  );

  const deferredSession = useDeferredValue(activeSession);

  const getIcon = (iconName: string, size = 14) => {
    switch (iconName) {
      case 'Test': return <FlaskConical size={size} />;
      case 'Lint': return <ListChecks size={size} />;
      case 'Configure': return <Wrench size={size} />;
      case 'Build': return <Hammer size={size} />;
      case 'Debug': return <Bug size={size} />;
      case 'Play': default: return <Play size={size} />;
    }
  };

  if (isBootstrapping || !state) {
    return (
      <div className="boot-shell">
        <div className="boot-shell__mark">Pi</div>
        <div className="boot-shell__copy">
          <p>Loading workspace registry</p>
          <span>Rehydrating sessions, themes, and approval policy.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar state={state} />
      
      <main className="main-pane" style={{ background: 'var(--bg)' }}>
        <header className="main-pane__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: '54px', borderBottom: 'none', background: 'var(--bg)', backdropFilter: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>
              {deferredSession ? deferredSession.title : "New thread"}
            </span>
            {activeWorkspace && (
              <span style={{ padding: '2px 8px', borderRadius: '12px', border: '1px solid #333', fontSize: '0.75rem', color: '#ccc' }}>
                {activeWorkspace.name}
              </span>
            )}
            {!forceGitRef && (
              <span style={{ padding: '2px 8px', borderRadius: '12px', border: '1px solid #422', fontSize: '0.75rem', color: '#f80', background: 'rgba(255,136,0,0.05)' }}>
                No Git
              </span>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            
            {activeWorkspaceActions.length > 0 ? (
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button 
                    className="topbar-btn" 
                    style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }}
                    title={activeWorkspaceActions[0].command}
                  >
                    {getIcon(activeWorkspaceActions[0].icon)} {activeWorkspaceActions[0].name}
                  </button>
                  <button 
                    className="topbar-btn" 
                    style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: '6px 4px' }}
                    onClick={() => setShowActionDropdown(!showActionDropdown)}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                {showActionDropdown && (
                  <>
                    <div className="click-away-layer" onClick={() => setShowActionDropdown(false)} />
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: '8px',
                      background: '#1C1C1E',
                      border: '1px solid #333',
                      borderRadius: '12px',
                      padding: '8px',
                      minWidth: '200px',
                      zIndex: 40,
                      boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px'
                    }}>
                      {activeWorkspaceActions.map(action => (
                        <div
                          key={action.id}
                          className="dropdown-item group"
                          style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
                        >
                          <button 
                            onClick={() => {
                              // TODO: Run action
                              setShowActionDropdown(false);
                            }}
                            style={{
                              background: 'transparent', border: 'none', color: 'inherit',
                              display: 'flex', alignItems: 'center', gap: '10px', flex: 1,
                              cursor: 'pointer', fontSize: '0.9rem', textAlign: 'left',
                              padding: 0
                            }}
                          >
                            {getIcon(action.icon)} <span style={{ flex: 1 }}>{action.name}</span>
                          </button>
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingActionId(action.id);
                              setShowActionModal(true);
                              setShowActionDropdown(false);
                            }}
                            style={{
                              background: 'rgba(255,255,255,0.1)', border: 'none', color: '#ccc',
                              borderRadius: '6px', width: '24px', height: '24px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', padding: 0
                            }}
                            title="Edit action"
                            className="edit-action-btn"
                          >
                            <Settings size={14} />
                          </button>
                        </div>
                      ))}
                      <div style={{ height: '1px', background: '#333', margin: '6px 0' }} />
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

            <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
              <button 
                className="topbar-btn" 
                style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }}
                title="Open in default editor"
              >
                <AppWindow size={14} /> Open
              </button>
              <button 
                className="topbar-btn" 
                style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: '6px 4px' }}
                title="Change editor"
                onClick={() => setShowOpenDropdown(!showOpenDropdown)}
              >
                <ChevronDown size={14} />
              </button>
              
              {showOpenDropdown && (
                <>
                  <div className="click-away-layer" onClick={() => setShowOpenDropdown(false)} />
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '8px',
                    background: '#1C1C1E',
                    border: '1px solid #333',
                    borderRadius: '12px',
                    padding: '8px',
                    minWidth: '180px',
                    zIndex: 40,
                    boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px'
                  }}>
                    <button className="dropdown-item" onClick={() => setShowOpenDropdown(false)}>
                      <AppWindow size={14} /> <span style={{ flex: 1 }}>Zed</span>
                      <span style={{ fontSize: '0.7rem', color: '#666' }}>⌘O</span>
                    </button>
                    <button className="dropdown-item" onClick={() => setShowOpenDropdown(false)}>
                      <Folder size={14} /> <span style={{ flex: 1 }}>Finder</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {!forceGitRef ? (
              <button className="topbar-btn" onClick={() => setForceGitRef(true)}>
                Initialize Git
              </button>
            ) : (
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button 
                    className="topbar-btn" 
                    style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }}
                  >
                    <CloudUpload size={14} /> Commit & push
                  </button>
                  <button 
                    className="topbar-btn" 
                    style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: '6px 4px' }}
                    onClick={() => setShowGitDropdown(!showGitDropdown)}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                {showGitDropdown && (
                  <>
                    <div className="click-away-layer" onClick={() => setShowGitDropdown(false)} />
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: '8px',
                      background: '#1C1C1E',
                      border: '1px solid #333',
                      borderRadius: '12px',
                      padding: '8px',
                      minWidth: '160px',
                      zIndex: 40,
                      boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px'
                    }}>
                      <button className="dropdown-item" onClick={() => setShowGitDropdown(false)}>
                        <GitCommit size={14} /> Commit
                      </button>
                      <button className="dropdown-item" onClick={() => setShowGitDropdown(false)}>
                        <CloudUpload size={14} /> Push
                      </button>
                      <button className="dropdown-item" onClick={() => setShowGitDropdown(false)}>
                        <GitPullRequest size={14} /> Create PR
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            
            <button className="topbar-btn icon-only" title="Terminal">
              <SquareTerminal size={14} />
            </button>
            <button className="topbar-btn icon-only" title="Diff">
              <GitCompare size={14} />
            </button>
            <button className="topbar-btn icon-only" onClick={() => state.activeWorkspaceId && void createSession(state.activeWorkspaceId)} title="New Session">
              <Plus size={14} />
            </button>
          </div>
        </header>

        <section className="conversation-view">
          <ConversationView
            workspace={activeWorkspace}
            session={deferredSession}
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
        .icon-only {
          padding: 0;
          width: 28px;
        }
        .click-away-layer {
          position: fixed;
          inset: 0;
          z-index: 30;
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
          background: #2A2A2C;
          color: white;
        }
        .edit-action-btn:hover {
          background: rgba(255,255,255,0.2) !important;
          color: #fff !important;
        }
      `}</style>
    </div>
  );
}
