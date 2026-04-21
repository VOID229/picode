import {
  Plus,
  Search,
  Settings,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Folder,
  ArrowDownUp,
  Trash2,
  Edit2,
  Copy,
  Hash,
  Archive,
  SquarePen,
} from "lucide-react";
import {
  useMemo,
  useState,
  useTransition,
  useCallback,
  useEffect,
} from "react";
import { Link } from "react-router-dom";
import type {
  PersistedAppState,
  WorkspaceRecord,
  ChatSession,
} from "../../domains/types";
import { cn } from "../../lib/cn";
import { copyTextToClipboard } from "../../lib/clipboard";
import { useAppStore } from "../../state/useAppStore";
import { ContextMenu, type ContextMenuItem } from "../layout/ContextMenu";
import { ProjectPicker } from "./ProjectPicker";
import { PromptModal } from "../layout/PromptModal";

interface SidebarProps {
  state: PersistedAppState;
}

export function Sidebar({ state }: SidebarProps) {
  const [query, setQuery] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const createWorkspace = useAppStore((store) => store.createWorkspace);

  const [projectSortOrder, setProjectSortOrder] = useState<
    "last-message" | "created" | "manual"
  >("last-message");
  const [threadSortOrder, setThreadSortOrder] = useState<
    "last-message" | "created"
  >("last-message");
  const [projectGrouping, setProjectGrouping] = useState<
    "repo" | "path" | "none"
  >("repo");
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [isModifierHeld, setIsModifierHeld] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control") setIsModifierHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control") setIsModifierHeld(false);
    };
    const handleBlur = () => setIsModifierHeld(false);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const filteredWorkspaces = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    let result = state.workspaces.filter((w) => {
      if (!normalized) return true;
      return (
        w.name.toLowerCase().includes(normalized) ||
        w.path.toLowerCase().includes(normalized)
      );
    });

    // Sorting logic for projects
    result = [...result].sort((a, b) => {
      if (projectSortOrder === "created") {
        // We don't have workspace.createdAt, so we might need to use recentRank or similar
        // For now let's assume recentRank is a proxy for creation or use session dates
        return a.recentRank - b.recentRank;
      }
      if (projectSortOrder === "last-message") {
        const lastA = Math.max(
          ...a.sessions.map((s) => new Date(s.updatedAt).getTime()),
          0,
        );
        const lastB = Math.max(
          ...b.sessions.map((s) => new Date(s.updatedAt).getTime()),
          0,
        );
        return lastB - lastA;
      }
      return 0; // Manual
    });

    return result;
  }, [query, state.workspaces, projectSortOrder]);

  const handleSortClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setSortMenu({ x: e.clientX, y: e.clientY });
  };

  const sortMenuItems = useMemo<ContextMenuItem[]>(
    () => [
      { label: "Sort projects", isHeader: true },
      {
        label: "Last user message",
        isChecked: projectSortOrder === "last-message",
        onClick: () => setProjectSortOrder("last-message"),
      },
      {
        label: "Created at",
        isChecked: projectSortOrder === "created",
        onClick: () => setProjectSortOrder("created"),
      },
      {
        label: "Manual",
        isChecked: projectSortOrder === "manual",
        onClick: () => setProjectSortOrder("manual"),
      },
      { label: "Sort threads", isHeader: true, separator: true },
      {
        label: "Last user message",
        isChecked: threadSortOrder === "last-message",
        onClick: () => setThreadSortOrder("last-message"),
      },
      {
        label: "Created at",
        isChecked: threadSortOrder === "created",
        onClick: () => setThreadSortOrder("created"),
      },
      { label: "Group projects", isHeader: true, separator: true },
      {
        label: "Group by repository",
        isChecked: projectGrouping === "repo",
        onClick: () => setProjectGrouping("repo"),
      },
      {
        label: "Group by repository path",
        isChecked: projectGrouping === "path",
        onClick: () => setProjectGrouping("path"),
      },
      {
        label: "Keep separate",
        isChecked: projectGrouping === "none",
        onClick: () => setProjectGrouping("none"),
      },
    ],
    [projectSortOrder, threadSortOrder, projectGrouping],
  );

  return (
    <aside
      className="sidebar"
      style={{
        backgroundColor: "#111",
        color: "#ccc",
        fontSize: "0.85rem",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div
        className="sidebar__header"
        style={
          {
            height: "54px",
            width: "100%",
            WebkitAppRegion: "drag",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            paddingLeft: "88px",
          } as React.CSSProperties
        }
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginTop: "-16px",
          }}
        >
          <span style={{ fontWeight: 600, color: "#fff", fontSize: "1.05rem" }}>
            picode
          </span>
          <span
            style={{
              fontSize: "0.6rem",
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "#888",
              background: "rgba(255,255,255,0.08)",
              padding: "2px 6px",
              borderRadius: "10px",
              marginTop: "1px",
            }}
          >
            ALPHA
          </span>
        </div>
      </div>

      <div
        style={{
          padding: "0 16px",
          marginBottom: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          flexShrink: 0,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "transparent",
            padding: "6px 8px",
            borderRadius: "6px",
            border: "1px solid #333",
          }}
        >
          <Search size={14} color="#666" />
          <input
            id="sidebar-search-input"
            value={query}
            onChange={(e) => startTransition(() => setQuery(e.target.value))}
            placeholder="Search"
            style={{
              border: "none",
              background: "transparent",
              outline: "none",
              color: "inherit",
              fontSize: "0.85rem",
              width: "100%",
            }}
          />
          <div
            style={{
              fontSize: "0.7rem",
              color: "#666",
              background: "#222",
              padding: "2px 4px",
              borderRadius: "4px",
            }}
          >
            ⌘K
          </div>
        </label>
      </div>

      <div
        className="sidebar__content"
        style={{
          padding: "0 10px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 6px",
            marginBottom: "4px",
          }}
        >
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 600,
              color: "#666",
              letterSpacing: "0.05em",
            }}
          >
            PROJECTS
          </span>
          <div style={{ display: "flex", gap: "12px", color: "#666" }}>
            <ArrowDownUp
              size={12}
              className="pointer action-icon"
              onClick={handleSortClick}
            />
            <Plus
              size={14}
              className="pointer action-icon"
              onClick={() => setIsPickerOpen(true)}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            paddingBottom: "8px",
          }}
        >
          {filteredWorkspaces.map((workspace) => (
            <ProjectNode
              key={workspace.id}
              workspace={workspace}
              state={state}
              threadSortOrder={threadSortOrder}
              isModifierHeld={isModifierHeld}
            />
          ))}
        </div>
      </div>

      {sortMenu && (
        <ContextMenu
          x={sortMenu.x}
          y={sortMenu.y}
          items={sortMenuItems}
          onClose={() => setSortMenu(null)}
        />
      )}

      <div style={{ marginTop: "auto", padding: "16px", flexShrink: 0 }}>
        <Link
          to="/settings"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "#888",
            textDecoration: "none",
            fontSize: "0.85rem",
            padding: "6px 8px",
            borderRadius: "6px",
            transition: "background 0.2s, color 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#222";
            e.currentTarget.style.color = "#ccc";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#888";
          }}
        >
          <Settings size={16} />
          Settings
        </Link>
      </div>

      {isPickerOpen && (
        <ProjectPicker
          onClose={() => setIsPickerOpen(false)}
          onSelect={(path) => {
            void createWorkspace(path);
            setIsPickerOpen(false);
          }}
        />
      )}
    </aside>
  );
}

function ProjectNode({
  workspace,
  state,
  threadSortOrder,
  isModifierHeld,
}: {
  workspace: WorkspaceRecord;
  state: PersistedAppState;
  threadSortOrder: "last-message" | "created";
  isModifierHeld: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(
    workspace.id === state.activeWorkspaceId,
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [renamePromptOpen, setRenamePromptOpen] = useState(false);

  const selectWorkspaceSession = useAppStore(
    (store) => store.selectWorkspaceSession,
  );
  const createSession = useAppStore((store) => store.createSession);
  const renameWorkspace = useAppStore((store) => store.renameWorkspace);
  const removeWorkspace = useAppStore((store) => store.removeWorkspace);
  const renameSession = useAppStore((store) => store.renameSession);
  const archiveSession = useAppStore((store) => store.archiveSession);
  const deleteSession = useAppStore((store) => store.deleteSession);

  const activeSessionId = state.activeSessionId;

  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    new Set(),
  );
  const [lastSelectedSessionId, setLastSelectedSessionId] = useState<
    string | null
  >(null);

  const visibleSessions = useMemo(() => {
    return workspace.sessions
      .filter((s) => !s.archivedAt)
      .sort((a, b) => {
        if (threadSortOrder === "created") {
          return (
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        }
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
  }, [workspace.sessions, threadSortOrder]);

  // Global shortcut handler for 1-9 to switch threads
  useEffect(() => {
    if (workspace.id !== state.activeWorkspaceId) return;

    const handleShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        const index = parseInt(e.key, 10) - 1;
        if (visibleSessions[index]) {
          e.preventDefault();
          selectWorkspaceSession(workspace.id, visibleSessions[index].id);
        }
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    workspace.id,
    state.activeWorkspaceId,
    selectWorkspaceSession,
    visibleSessions,
  ]);

  const handleProjectContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const projectMenuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        label: "Rename project",
        icon: <Edit2 size={14} />,
        onClick: () => {
          setRenamePromptOpen(true);
        },
      },
      {
        label: "Project grouping...",
        onClick: () => console.log("Grouping not implemented"),
      },
      {
        label: "Copy Project Path",
        icon: <Copy size={14} />,
        separator: true,
        onClick: async () => {
          await copyTextToClipboard(workspace.path, "project path");
        },
      },
      {
        label: "Remove project",
        icon: <Trash2 size={14} />,
        variant: "danger",
        onClick: async () => {
          const { ask } = await import("@tauri-apps/plugin-dialog");
          const confirmed = await ask(
            `Are you sure you want to remove ${workspace.name}?`,
            {
              title: "Remove Project",
              kind: "warning",
            },
          );
          if (confirmed) {
            void removeWorkspace(workspace.id);
          }
        },
      },
    ],
    [workspace, renameWorkspace, removeWorkspace],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 8px",
          borderRadius: "6px",
          color: workspace.id === state.activeWorkspaceId ? "#fff" : "#aaa",
        }}
        onClick={() => setIsExpanded(!isExpanded)}
        onContextMenu={handleProjectContextMenu}
        className="project-row group"
        onMouseEnter={(e) => (e.currentTarget.style.background = "#222")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: "4px", flex: 1 }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {isExpanded ? (
            <FolderOpen size={14} color="#666" />
          ) : (
            <Folder size={14} color="#666" />
          )}
          <span
            style={{
              fontWeight: workspace.id === state.activeWorkspaceId ? 600 : 400,
            }}
          >
            {workspace.name}
          </span>
        </div>
        <div
          className="project-actions"
          style={{ opacity: 0, transition: "opacity 0.2s" }}
        >
          <SquarePen
            size={14}
            className="pointer action-icon"
            onClick={(e) => {
              e.stopPropagation();
              createSession(workspace.id);
            }}
          />
        </div>
      </div>

      {isExpanded && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginLeft: "12px",
            borderLeft: "1px solid #333",
            paddingLeft: "8px",
            paddingTop: "4px",
            paddingBottom: "8px",
          }}
        >
          {visibleSessions.length === 0 ? (
            <div
              style={{ fontSize: "0.75rem", color: "#555", padding: "4px 8px" }}
            >
              No threads yet
            </div>
          ) : (
            visibleSessions.map((session, index) => {
              const isSelected = selectedSessionIds.has(session.id);
              return (
                <SessionItem
                  key={session.id}
                  session={session}
                  workspace={workspace}
                  isActive={session.id === activeSessionId}
                  isSelected={isSelected}
                  selectedCount={selectedSessionIds.size}
                  isModifierHeld={isModifierHeld}
                  shortcutKey={
                    workspace.id === state.activeWorkspaceId && index < 9
                      ? String(index + 1)
                      : undefined
                  }
                  onSelect={(e) => {
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      e.stopPropagation();
                      const newSel = new Set(selectedSessionIds);
                      if (newSel.has(session.id)) {
                        newSel.delete(session.id);
                      } else {
                        newSel.add(session.id);
                      }
                      setSelectedSessionIds(newSel);
                      setLastSelectedSessionId(session.id);
                    } else if (e.shiftKey && lastSelectedSessionId) {
                      e.preventDefault();
                      e.stopPropagation();
                      const currentIndex = visibleSessions.findIndex(
                        (s) => s.id === session.id,
                      );
                      const lastIndex = visibleSessions.findIndex(
                        (s) => s.id === lastSelectedSessionId,
                      );
                      if (currentIndex !== -1 && lastIndex !== -1) {
                        const start = Math.min(currentIndex, lastIndex);
                        const end = Math.max(currentIndex, lastIndex);
                        const newSel = new Set(selectedSessionIds);
                        for (let i = start; i <= end; i++) {
                          newSel.add(visibleSessions[i].id);
                        }
                        setSelectedSessionIds(newSel);
                      }
                    } else {
                      setSelectedSessionIds(new Set([session.id]));
                      setLastSelectedSessionId(session.id);
                      selectWorkspaceSession(workspace.id, session.id);
                    }
                  }}
                  onClearSelection={() => {
                    setSelectedSessionIds(new Set([session.id]));
                    setLastSelectedSessionId(session.id);
                  }}
                  onRename={(title) =>
                    renameSession(workspace.id, session.id, title)
                  }
                  onArchive={() => archiveSession(workspace.id, session.id)}
                  onDelete={() => deleteSession(workspace.id, session.id)}
                  onDeleteMultiple={async () => {
                    for (const id of Array.from(selectedSessionIds)) {
                      await deleteSession(workspace.id, id);
                    }
                    setSelectedSessionIds(new Set());
                  }}
                />
              );
            })
          )}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={projectMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {renamePromptOpen && (
        <PromptModal
          title="Rename project"
          initialValue={workspace.name}
          onConfirm={(name) => {
            if (name) void renameWorkspace(workspace.id, name);
            setRenamePromptOpen(false);
          }}
          onCancel={() => setRenamePromptOpen(false)}
        />
      )}

      <style>{`
                .project-row:hover .project-actions {
                  opacity: 1 !important;
                }
                .pointer:hover {
                  cursor: pointer;
                }
                .project-row:hover {
                  cursor: pointer;
                }
                .session-item:hover {
                  cursor: pointer;
                }
                .session-item:hover .archive-btn {
                  display: block !important;
                }
                .session-item:hover .session-status {
                  display: none;
                }
                .archive-btn:hover {
                  color: #fff !important;
                }
              `}</style>
    </div>
  );
}

function SessionItem({
  session,
  workspace,
  isActive,
  isSelected,
  selectedCount,
  isModifierHeld,
  shortcutKey,
  onSelect,
  onClearSelection,
  onRename,
  onArchive,
  onDelete,
  onDeleteMultiple,
}: {
  session: ChatSession;
  workspace: WorkspaceRecord;
  isActive: boolean;
  isSelected: boolean;
  selectedCount: number;
  isModifierHeld?: boolean;
  shortcutKey?: string;
  onSelect: (e: React.MouseEvent) => void;
  onClearSelection: () => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onDelete: () => void;
  onDeleteMultiple: () => void;
}) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [renamePromptOpen, setRenamePromptOpen] = useState(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isSelected) {
      onClearSelection();
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (selectedCount > 1 && isSelected) {
      return [
        {
          label: `Mark unread (${selectedCount})`,
          onClick: () => console.log("Mark unread not implemented"),
        },
        {
          label: `Delete (${selectedCount})`,
          icon: <Trash2 size={14} />,
          variant: "danger",
          separator: true,
          onClick: async () => {
            const { ask } = await import("@tauri-apps/plugin-dialog");
            const confirmed = await ask(
              `Are you sure you want to delete ${selectedCount} threads?`,
              {
                title: "Delete Threads",
                kind: "warning",
              },
            );
            if (confirmed) {
              onDeleteMultiple();
            }
          },
        },
      ];
    }
    return [
      {
        label: "Rename thread",
        icon: <Edit2 size={14} />,
        onClick: () => {
          setRenamePromptOpen(true);
        },
      },
      {
        label: "Archive thread",
        icon: <Archive size={14} />,
        onClick: onArchive,
      },
      {
        label: "Mark unread",
        onClick: () => console.log("Mark unread not implemented"),
      },
      {
        label: "Copy Path",
        icon: <Copy size={14} />,
        onClick: async () => {
          await copyTextToClipboard(
            `${workspace.path}/${session.title}`,
            "thread path",
          );
        },
      },
      {
        label: "Copy Thread ID",
        icon: <Hash size={14} />,
        separator: true,
        onClick: async () => {
          await copyTextToClipboard(session.id, "thread ID");
        },
      },
      {
        label: "Delete",
        icon: <Trash2 size={14} />,
        variant: "danger",
        onClick: async () => {
          const { ask } = await import("@tauri-apps/plugin-dialog");
          const confirmed = await ask(
            "Are you sure you want to delete this thread?",
            {
              title: "Delete Thread",
              kind: "warning",
            },
          );
          if (confirmed) {
            onDelete();
          }
        },
      },
    ];
  }, [
    session,
    workspace,
    isSelected,
    selectedCount,
    onRename,
    onArchive,
    onDelete,
    onDeleteMultiple,
  ]);

  const isMultiSelected = isSelected && selectedCount > 1;

  return (
    <>
      <div
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        className="session-item"
        style={{
          userSelect: "none",
          padding: "6px 8px",
          borderRadius: "6px",
          color: isMultiSelected ? "#fff" : isActive ? "#fff" : "#888",
          background: isMultiSelected
            ? "#274377"
            : isActive
              ? "rgba(255,255,255,0.05)"
              : "transparent",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          transition: "background 0.2s, color 0.2s",
        }}
        onMouseEnter={(e) => {
          if (isMultiSelected) {
            e.currentTarget.style.background = "#2a4880";
          } else {
            e.currentTarget.style.background = isActive
              ? "rgba(255,255,255,0.08)"
              : "#222";
            if (!isActive) e.currentTarget.style.color = "#ccc";
          }
        }}
        onMouseLeave={(e) => {
          if (isMultiSelected) {
            e.currentTarget.style.background = "#274377";
          } else {
            e.currentTarget.style.background = isActive
              ? "rgba(255,255,255,0.05)"
              : "transparent";
            if (!isActive) e.currentTarget.style.color = "#888";
          }
        }}
      >
        <span className="truncate" style={{ flex: 1, marginRight: "8px" }}>
          {session.title}
        </span>
        <div
          className="session-actions"
          style={{ display: "flex", alignItems: "center", gap: "6px" }}
        >
          <span
            style={{ fontSize: "0.65rem", color: "#555" }}
            className="session-status"
          >
            {isModifierHeld && shortcutKey ? (
              <span
                style={{
                  background: "rgba(255,255,255,0.1)",
                  color: "#fff",
                  padding: "1px 4px",
                  borderRadius: "4px",
                  fontFamily: "monospace",
                  fontSize: "0.6rem",
                }}
              >
                ⌘{shortcutKey}
              </span>
            ) : session.status === "streaming" ? (
              "Active"
            ) : (
              formatTimeAgo(session.updatedAt)
            )}
          </span>
          <Archive
            size={14}
            className="archive-btn action-icon"
            style={{
              color: "#666",
              display: "none",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          />
        </div>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
      {renamePromptOpen && (
        <PromptModal
          title="Rename thread"
          initialValue={session.title}
          onConfirm={(title) => {
            if (title) onRename(title);
            setRenamePromptOpen(false);
          }}
          onCancel={() => setRenamePromptOpen(false)}
        />
      )}
    </>
  );
}

function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
