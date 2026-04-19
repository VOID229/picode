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
} from "lucide-react";
import { useMemo, useState, useTransition, useCallback } from "react";
import { Link } from "react-router-dom";
import type {
  PersistedAppState,
  WorkspaceRecord,
  ChatSession,
} from "../../domains/types";
import { cn } from "../../lib/cn";
import { useAppStore } from "../../state/useAppStore";
import { ContextMenu, type ContextMenuItem } from "../layout/ContextMenu";
import { ProjectPicker } from "./ProjectPicker";

interface SidebarProps {
  state: PersistedAppState;
}

export function Sidebar({ state }: SidebarProps) {
  const [query, setQuery] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const createWorkspace = useAppStore((store) => store.createWorkspace);

  const filteredWorkspaces = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return state.workspaces.filter((w) => {
      if (!normalized) return true;
      return (
        w.name.toLowerCase().includes(normalized) ||
        w.path.toLowerCase().includes(normalized)
      );
    });
  }, [query, state.workspaces]);

  return (
    <aside
      className="sidebar"
      style={{ backgroundColor: "#111", color: "#ccc", fontSize: "0.85rem" }}
    >
      <div
        className="sidebar__header"
        style={{
          height: "54px",
          width: "100%",
          WebkitAppRegion: "drag",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          paddingLeft: "88px",
        } as React.CSSProperties}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "-16px" }}>
          <span style={{ fontWeight: 600, color: "#fff", fontSize: "1.05rem" }}>
            picode
          </span>
          <span style={{ 
            fontSize: "0.6rem", 
            fontWeight: 700, 
            letterSpacing: "0.05em",
            color: "#888", 
            background: "rgba(255,255,255,0.08)", 
            padding: "2px 6px", 
            borderRadius: "10px",
            marginTop: "1px"
          }}>
            ALPHA
          </span>
        </div>
      </div>

      <div style={{ padding: "0 16px", marginBottom: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
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
            <ArrowDownUp size={12} className="pointer" />
            <Plus
              size={14}
              className="pointer"
              onClick={() => setIsPickerOpen(true)}
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {filteredWorkspaces.map((workspace) => (
            <ProjectNode
              key={workspace.id}
              workspace={workspace}
              state={state}
            />
          ))}
        </div>
      </div>

      <div style={{ marginTop: "auto", padding: "16px" }}>
        <Link
          to="/settings"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "#888",
            textDecoration: "none",
            fontSize: "0.85rem",
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
}: {
  workspace: WorkspaceRecord;
  state: PersistedAppState;
}) {
  const [isExpanded, setIsExpanded] = useState(
    workspace.id === state.activeWorkspaceId,
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const selectWorkspaceSession = useAppStore(
    (store) => store.selectWorkspaceSession,
  );
  const createSession = useAppStore((store) => store.createSession);
  const renameWorkspace = useAppStore((store) => store.renameWorkspace);
  const removeWorkspace = useAppStore((store) => store.removeWorkspace);
  const renameSession = useAppStore((store) => store.renameSession);
  const deleteSession = useAppStore((store) => store.deleteSession);

  const activeSessionId = state.activeSessionId;

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
          const name = prompt("Enter new project name", workspace.name);
          if (name) void renameWorkspace(workspace.id, name);
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
        onClick: () => navigator.clipboard.writeText(workspace.path),
      },
      {
        label: "Remove project",
        icon: <Trash2 size={14} />,
        variant: "danger",
        onClick: () => {
          if (confirm(`Are you sure you want to remove ${workspace.name}?`)) {
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
          <Plus
            size={14}
            className="pointer"
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
          {workspace.sessions.length === 0 ? (
            <div
              style={{ fontSize: "0.75rem", color: "#555", padding: "4px 8px" }}
            >
              No threads yet
            </div>
          ) : (
            workspace.sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                workspace={workspace}
                isActive={session.id === activeSessionId}
                onSelect={() =>
                  selectWorkspaceSession(workspace.id, session.id)
                }
                onRename={(title) =>
                  renameSession(workspace.id, session.id, title)
                }
                onDelete={() => deleteSession(workspace.id, session.id)}
              />
            ))
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
              `}</style>
    </div>
  );
}

function SessionItem({
  session,
  workspace,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  session: ChatSession;
  workspace: WorkspaceRecord;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const menuItems = useMemo<ContextMenuItem[]>(
    () => [
      {
        label: "Rename thread",
        icon: <Edit2 size={14} />,
        onClick: () => {
          const title = prompt("Enter new thread title", session.title);
          if (title) onRename(title);
        },
      },
      {
        label: "Mark unread",
        onClick: () => console.log("Mark unread not implemented"),
      },
      {
        label: "Copy Path",
        icon: <Copy size={14} />,
        onClick: () =>
          navigator.clipboard.writeText(`${workspace.path}/${session.title}`),
      },
      {
        label: "Copy Thread ID",
        icon: <Hash size={14} />,
        separator: true,
        onClick: () => navigator.clipboard.writeText(session.id),
      },
      {
        label: "Delete",
        icon: <Trash2 size={14} />,
        variant: "danger",
        onClick: () => {
          if (confirm("Are you sure you want to delete this thread?")) {
            onDelete();
          }
        },
      },
    ],
    [session, workspace, onRename, onDelete],
  );

  return (
    <>
      <div
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        className="session-item"
        style={{
          padding: "6px 8px",
          borderRadius: "6px",
          color: isActive ? "#fff" : "#888",
          background: isActive ? "rgba(255,255,255,0.05)" : "transparent",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          transition: "background 0.2s, color 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = isActive
            ? "rgba(255,255,255,0.08)"
            : "#222";
          if (!isActive) e.currentTarget.style.color = "#ccc";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isActive
            ? "rgba(255,255,255,0.05)"
            : "transparent";
          if (!isActive) e.currentTarget.style.color = "#888";
        }}
      >
        <span className="truncate" style={{ flex: 1, marginRight: "8px" }}>
          {session.title}
        </span>
        <span style={{ fontSize: "0.65rem", color: "#555" }}>
          {session.status === "streaming" ? "Active" : "..."}
        </span>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
