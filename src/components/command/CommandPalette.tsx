import React, { useDeferredValue, useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../state/useAppStore";
import { Search, SquarePen, FolderPlus, Settings, MessageSquare, ChevronRight, ArrowUp, ArrowDown, Folder } from "lucide-react";
import { ProjectPicker } from "../sidebar/ProjectPicker";

function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const open = useAppStore((state) => state.commandPaletteOpen);
  const setOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const state = useAppStore((store) => store.state);
  const createSession = useAppStore((store) => store.createSession);
  const selectWorkspaceSession = useAppStore((store) => store.selectWorkspaceSession);
  const createWorkspace = useAppStore((store) => store.createWorkspace);
  
  const deferredQuery = useDeferredValue(query.toLowerCase());
  const navigate = useNavigate();

  const [mode, setMode] = useState<"default" | "select-workspace">("default");
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeWorkspace = useMemo(
    () => state?.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? null,
    [state]
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIndex(0);
      setMode("default");
      setShowProjectPicker(false);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [deferredQuery, mode]);

  const allItems = useMemo(() => {
    if (!state) return { section1Title: "", section1Items: [], section2Title: "", section2Items: [], flat: [] };

    if (mode === "select-workspace") {
      const items = state.workspaces.map(w => ({
        id: `ws-${w.id}`,
        type: "thread" as const,
        icon: Folder,
        title: w.name,
        subtitle: w.path,
        workspaceName: "",
        branch: "",
        isCurrent: false,
        updatedAt: "",
        matchText: `${w.name} ${w.path}`,
        run: () => {
          void createSession(w.id);
          setOpen(false);
        }
      }));

      const filteredItems = items.filter(i => i.matchText.toLowerCase().includes(deferredQuery));
      return {
        section1Title: "Select Workspace",
        section1Items: filteredItems,
        section2Title: "",
        section2Items: [],
        flat: filteredItems
      };
    }

    const actions = [
      {
        id: "new-thread-active",
        type: "action" as const,
        icon: SquarePen,
        title: "New thread in ",
        boldSuffix: activeWorkspace?.name,
        shortcut: activeWorkspace ? "⇧⌘O" : undefined,
        showArrow: !activeWorkspace,
        matchText: activeWorkspace ? `new thread in ${activeWorkspace.name}` : "new thread in",
        run: () => {
          if (activeWorkspace) {
            void createSession(activeWorkspace.id);
            setOpen(false);
          }
        }
      },
      {
        id: "new-thread-other",
        type: "action" as const,
        icon: SquarePen,
        title: "New thread in...",
        showArrow: true,
        matchText: "new thread in",
        run: () => { 
          setMode("select-workspace");
          setQuery("");
        }
      },
      {
        id: "add-project",
        type: "action" as const,
        icon: FolderPlus,
        title: "Add project",
        matchText: "add project",
        run: () => { 
          setShowProjectPicker(true);
        }
      },
      {
        id: "open-settings",
        type: "action" as const,
        icon: Settings,
        title: "Open settings",
        matchText: "open settings",
        run: () => {
          navigate("/settings");
          setOpen(false);
        }
      }
    ];

    const threads = state.workspaces.flatMap(workspace => 
      workspace.sessions.filter(s => !s.archivedAt).map(session => ({
        id: `thread-${session.id}`,
        type: "thread" as const,
        icon: MessageSquare,
        title: session.title,
        subtitle: "",
        workspaceName: workspace.name,
        branch: session.branchLabel || "main",
        isCurrent: session.id === state.activeSessionId,
        updatedAt: session.updatedAt,
        matchText: `${session.title} ${workspace.name}`,
        run: () => {
          void selectWorkspaceSession(workspace.id, session.id);
          setOpen(false);
        }
      }))
    ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const filteredActions = actions.filter(a => a.matchText.toLowerCase().includes(deferredQuery));
    const filteredThreads = threads.filter(t => t.matchText.toLowerCase().includes(deferredQuery));

    return {
      section1Title: "Actions",
      section1Items: filteredActions,
      section2Title: "Recent Threads",
      section2Items: filteredThreads,
      flat: [...filteredActions, ...filteredThreads]
    };
  }, [state, activeWorkspace, createSession, navigate, selectWorkspaceSession, deferredQuery, mode, setOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow escape to close project picker natively if it is open, we'll let it handle itself
      if (showProjectPicker) return;

      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, Math.max(0, allItems.flat.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = allItems.flat[selectedIndex];
        if (item) {
          item.run();
        }
      }
    };
    
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, showProjectPicker, allItems.flat, selectedIndex, setOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      const selectedEl = scrollRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex]);

  if (!open) return null;

  if (showProjectPicker) {
    return (
      <ProjectPicker
        onClose={() => {
          setShowProjectPicker(false);
          setOpen(false);
        }}
        onSelect={(path) => {
          void createWorkspace(path);
          setShowProjectPicker(false);
          setOpen(false);
        }}
      />
    );
  }

  const renderItem = (item: any, isSelected: boolean, globalIndex: number) => {
    const Icon = item.icon;
    if (item.type === "action") {
      return (
        <div
          key={item.id}
          data-index={globalIndex}
          onClick={() => item.run()}
          onMouseEnter={() => setSelectedIndex(globalIndex)}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 16px",
            margin: "2px 8px",
            borderRadius: "8px",
            backgroundColor: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
            cursor: "default"
          }}
        >
          <Icon size={18} color="#888" />
          <div style={{ marginLeft: "12px", color: isSelected ? "#fff" : "#eee", flex: 1, fontSize: "0.95rem" }}>
            {item.title}
            {item.boldSuffix && <span style={{ fontWeight: 600 }}>{item.boldSuffix}</span>}
          </div>
          {item.shortcut && (
            <div style={{ color: "#666", fontSize: "0.9rem", letterSpacing: "1px" }}>
              {item.shortcut}
            </div>
          )}
          {item.showArrow && (
            <ChevronRight size={16} color="#666" />
          )}
        </div>
      );
    }

    if (item.type === "thread") {
      return (
        <div
          key={item.id}
          data-index={globalIndex}
          onClick={() => item.run()}
          onMouseEnter={() => setSelectedIndex(globalIndex)}
          style={{
            display: "flex",
            padding: "10px 16px",
            margin: "2px 8px",
            borderRadius: "8px",
            backgroundColor: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
            cursor: "default"
          }}
        >
          <div style={{ marginTop: "2px" }}>
            <Icon size={18} color="#888" />
          </div>
          <div style={{ marginLeft: "12px", flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{ color: isSelected ? "#fff" : "#eee", fontSize: "0.95rem", fontWeight: 500 }}>
              {item.title}
            </div>
            <div style={{ color: "#777", fontSize: "0.8rem" }}>
              {item.subtitle ? item.subtitle : `${item.workspaceName} \u00B7 #${item.branch} ${item.isCurrent ? " \u00B7 Current thread" : ""}`}
            </div>
          </div>
          <div style={{ color: "#666", fontSize: "0.8rem", paddingTop: "2px" }}>
            {item.updatedAt ? formatTimeAgo(item.updatedAt) : ""}
          </div>
        </div>
      );
    }
  };

  return (
    <div
      className="palette-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh"
      }}
      onClick={() => setOpen(false)}
    >
      <div
        className="palette"
        style={{
          width: "100%",
          maxWidth: "700px",
          backgroundColor: "#1C1C1E",
          borderRadius: "16px",
          border: "1px solid #333",
          boxShadow: "0 24px 48px rgba(0,0,0,0.7)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "16px", borderBottom: "1px solid #333" }}>
          <Search size={22} color="#888" style={{ marginRight: "12px" }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "select-workspace" ? "Search projects..." : "Search commands, projects, and threads..."}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#eee",
              fontSize: "1.1rem"
            }}
          />
        </div>

        <div 
          ref={scrollRef}
          style={{ 
            maxHeight: "50vh", 
            overflowY: "auto", 
            padding: "8px 0" 
          }}
        >
          {allItems.section1Items.length > 0 && (
            <div style={{ marginBottom: "8px" }}>
              <div style={{ padding: "8px 16px", fontSize: "0.8rem", fontWeight: 600, color: "#888" }}>
                {allItems.section1Title}
              </div>
              {allItems.section1Items.map((item) => {
                const globalIndex = allItems.flat.findIndex(i => i.id === item.id);
                return renderItem(item, globalIndex === selectedIndex, globalIndex);
              })}
            </div>
          )}

          {allItems.section2Items.length > 0 && (
            <div>
              <div style={{ padding: "8px 16px", fontSize: "0.8rem", fontWeight: 600, color: "#888", marginTop: "4px" }}>
                {allItems.section2Title}
              </div>
              {allItems.section2Items.map((item) => {
                const globalIndex = allItems.flat.findIndex(i => i.id === item.id);
                return renderItem(item, globalIndex === selectedIndex, globalIndex);
              })}
            </div>
          )}
        </div>

        <div style={{ 
          borderTop: "1px solid #333", 
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#666", fontSize: "0.75rem", fontFamily: "inherit" }}>
            <div style={{ display: "flex", gap: "4px" }}>
              <span style={{ background: "#2A2A2C", border: "1px solid #333", padding: "2px 5px", borderRadius: "4px", fontSize: "0.7rem", display: "flex", alignItems: "center" }}><ArrowUp size={10} /></span>
              <span style={{ background: "#2A2A2C", border: "1px solid #333", padding: "2px 5px", borderRadius: "4px", fontSize: "0.7rem", display: "flex", alignItems: "center" }}><ArrowDown size={10} /></span>
            </div>
            <span style={{fontWeight: 500}}>Navigate</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#666", fontSize: "0.75rem", fontFamily: "inherit" }}>
            <span style={{ background: "#2A2A2C", border: "1px solid #333", padding: "2px 5px", borderRadius: "4px", fontSize: "0.8rem" }}>Enter</span>
            <span style={{fontWeight: 500}}>Select</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#666", fontSize: "0.75rem", fontFamily: "inherit" }}>
            <span style={{ background: "#2A2A2C", border: "1px solid #333", padding: "2px 5px", borderRadius: "4px", fontSize: "0.8rem" }}>Esc</span>
            <span style={{fontWeight: 500}}>Close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
