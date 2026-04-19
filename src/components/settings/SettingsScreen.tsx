import { ArrowLeft, SlidersHorizontal, Link as LinkIcon, Archive, RotateCcw, Trash2, RefreshCw } from "lucide-react";
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useAppStore } from "../../state/useAppStore";

function Toggle({ checked }: { checked: boolean }) {
  return (
    <div style={{
      width: "36px", height: "20px", borderRadius: "10px",
      background: checked ? "#2563eb" : "#333", position: "relative", cursor: "pointer",
      transition: "background 0.2s"
    }}>
      <div style={{
        width: "16px", height: "16px", borderRadius: "50%", background: "#fff",
        position: "absolute", top: "2px", left: checked ? "18px" : "2px",
        transition: "left 0.2s"
      }} />
    </div>
  );
}

function SettingRow({ label, description, control }: { label: React.ReactNode, description: React.ReactNode, control: React.ReactNode }) {
  return (
    <div className="setting-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #222" }}>
      <div style={{ maxWidth: "70%" }}>
        <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#fff" }}>{label}</div>
        <div style={{ fontSize: "0.8rem", color: "#888", marginTop: "4px", lineHeight: "1.4" }}>{description}</div>
      </div>
      <div>
        {control}
      </div>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ width: "16px", height: "1px", background: "#333" }} />
        <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#666", letterSpacing: "0.05em" }}>{title}</span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #222", borderRadius: "12px", overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const [activeTab, setActiveTab] = useState("general");

  const controlStyle = {
    background: "#111",
    color: "#fff",
    border: "1px solid #333",
    padding: "8px 12px",
    borderRadius: "6px",
    outline: "none",
    minWidth: "160px",
    fontSize: "0.85rem"
  };

  const btnStyle = {
    background: "transparent",
    color: "#fff",
    border: "1px solid #333",
    padding: "6px 12px",
    borderRadius: "6px", 
    outline: "none",
    cursor: "pointer",
    fontSize: "0.85rem"
  };

  const state = useAppStore((store) => store.state);
  const restoreSession = useAppStore((store) => store.restoreSession);
  const deleteSession = useAppStore((store) => store.deleteSession);

  const archivedSessions = useMemo(() => {
    if (!state) return [];
    const archived: Array<{ workspaceId: string, workspaceName: string, session: any }> = [];
    state.workspaces.forEach(workspace => {
      workspace.sessions.forEach(session => {
        if (session.archivedAt) {
          archived.push({
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            session
          });
        }
      });
    });
    return archived.sort((a, b) => {
      const dateA = a.session.archivedAt ? new Date(a.session.archivedAt).getTime() : 0;
      const dateB = b.session.archivedAt ? new Date(b.session.archivedAt).getTime() : 0;
      return dateB - dateA;
    });
  }, [state]);

  return (
    <div style={{ display: "flex", width: "100%", height: "100vh", backgroundColor: "#0a0a0a", color: "#fff" }}>
      {/* Sidebar */}
      <div style={{ width: "260px", borderRight: "1px solid #222", display: "flex", flexDirection: "column", backgroundColor: "#111" }}>
        <div
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

        <div style={{ padding: "16px 12px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div 
            onClick={() => setActiveTab("general")}
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "6px", background: activeTab === "general" ? "rgba(255,255,255,0.08)" : "transparent", color: activeTab === "general" ? "#fff" : "#888", cursor: "pointer", transition: "background 0.2s, color 0.2s" }}
            onMouseEnter={(e) => { if(activeTab !== "general") { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#ccc"; } }}
            onMouseLeave={(e) => { if(activeTab !== "general") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#888"; } }}
          >
            <SlidersHorizontal size={14} />
            <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>General</span>
          </div>
          <div 
            onClick={() => setActiveTab("connections")}
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "6px", background: activeTab === "connections" ? "rgba(255,255,255,0.08)" : "transparent", color: activeTab === "connections" ? "#fff" : "#888", cursor: "pointer", transition: "background 0.2s, color 0.2s" }}
            onMouseEnter={(e) => { if(activeTab !== "connections") { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#ccc"; } }}
            onMouseLeave={(e) => { if(activeTab !== "connections") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#888"; } }}
          >
            <LinkIcon size={14} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: 1 }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Connections</span>
              <span style={{ fontSize: "0.55rem", fontWeight: 700, letterSpacing: "0.05em", color: "#888", background: "rgba(255,255,255,0.08)", padding: "2px 6px", borderRadius: "10px", textTransform: "uppercase" }}>Coming Soon</span>
            </div>
          </div>
          <div 
            onClick={() => setActiveTab("archive")}
            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "6px", background: activeTab === "archive" ? "rgba(255,255,255,0.08)" : "transparent", color: activeTab === "archive" ? "#fff" : "#888", cursor: "pointer", transition: "background 0.2s, color 0.2s" }}
            onMouseEnter={(e) => { if(activeTab !== "archive") { e.currentTarget.style.background = "#222"; e.currentTarget.style.color = "#ccc"; } }}
            onMouseLeave={(e) => { if(activeTab !== "archive") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#888"; } }}
          >
            <Archive size={14} />
            <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Archive</span>
          </div>
        </div>

        <div style={{ marginTop: "auto", padding: "16px" }}>
          <Link
            to="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "#888",
              textDecoration: "none",
              fontSize: "0.85rem",
              padding: "6px 8px",
              borderRadius: "6px",
              transition: "background 0.2s, color 0.2s"
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
            <ArrowLeft size={16} />
            Back
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <div style={{ padding: "0 24px", height: "54px", minHeight: "54px", display: "flex", justifyContent: "space-between", alignItems: "center", WebkitAppRegion: "drag", borderBottom: "1px solid #222" } as React.CSSProperties}>
          <div style={{ fontSize: "0.85rem", color: "#888" }}>Settings</div>
          <button style={{ display: "flex", alignItems: "center", gap: "6px", background: "transparent", border: "1px solid #333", color: "#ccc", padding: "6px 12px", borderRadius: "6px", fontSize: "0.75rem", cursor: "pointer", WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <RotateCcw size={12} />
            Restore defaults
          </button>
        </div>
        
        <div style={{ flex: 1, overflowY: "auto", padding: "40px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: "100%", maxWidth: "800px", display: "flex", flexDirection: "column", gap: "40px" }}>
            
            {activeTab === "general" && (
              <>
                <SettingsSection title="GENERAL">
                  <SettingRow 
                    label="Theme" 
                    description="Choose how picode looks across the app." 
                    control={<select style={controlStyle} defaultValue="System"><option>System</option><option>Dark</option><option>Light</option></select>} 
                  />
                  <SettingRow 
                    label="Time format" 
                    description="System default follows your browser or OS clock preference." 
                    control={<select style={controlStyle} defaultValue="System default"><option>System default</option><option>12-hour</option><option>24-hour</option></select>} 
                  />
                  <SettingRow 
                    label="Diff line wrapping" 
                    description="Set the default wrap state when the diff panel opens." 
                    control={<Toggle checked={false} />} 
                  />
                  <SettingRow 
                    label="Assistant output" 
                    description="Show token-by-token output while a response is in progress." 
                    control={<Toggle checked={false} />} 
                  />
                  <SettingRow 
                    label="New threads" 
                    description="Pick the default workspace mode for newly created draft threads." 
                    control={<select style={controlStyle} defaultValue="Local"><option>Local</option><option>Cloud</option></select>} 
                  />
                  <SettingRow 
                    label="Add project starts in" 
                    description='Leave empty to use "~/" when the Add Project browser opens.' 
                    control={<input style={controlStyle} defaultValue="~/" />} 
                  />
                  <SettingRow 
                    label="Archive confirmation" 
                    description="Require a second click on the inline archive action before a thread is archived." 
                    control={<Toggle checked={false} />} 
                  />
                  <SettingRow 
                    label="Delete confirmation" 
                    description="Ask before deleting a thread and its chat history." 
                    control={<Toggle checked={true} />} 
                  />
                  <SettingRow 
                    label="Text generation model" 
                    description="Configures the model used for suggested changes over files or workspaces." 
                    control={<select style={controlStyle} defaultValue="High"><option>High</option><option>Low</option></select>} 
                  />
                </SettingsSection>

                <SettingsSection title="ADVANCED">
                  <SettingRow 
                    label="Keybindings" 
                    description={
                      <div style={{ marginTop: "4px" }}>
                        Open the persisted `keybindings.json` file to edit advanced bindings directly.
                        <div style={{ fontFamily: "monospace", color: "#888", marginTop: "4px", marginBottom: "4px" }}>/Users/gal/.picode/userdata/keybindings.json</div>
                        Opens in your preferred editor.
                      </div>
                    } 
                    control={<button style={btnStyle}>Open file</button>} 
                  />
                </SettingsSection>

                <SettingsSection title="ABOUT">
                  <SettingRow 
                    label={<>Version <span style={{ fontFamily: "monospace", color: "#888", marginLeft: "6px", fontWeight: 400 }}>0.0.20</span></>} 
                    description="Current version of the application." 
                    control={<button style={btnStyle}>Check for Updates</button>} 
                  />
                  <SettingRow 
                    label="Update track" 
                    description="Stable follows full releases. Nightly follows the nightly desktop channel and can switch back to stable immediately." 
                    control={<select style={controlStyle} defaultValue="Nightly"><option>Stable</option><option>Nightly</option></select>} 
                  />
                  <SettingRow 
                    label="Diagnostics" 
                    description={
                      <div style={{ marginTop: "4px" }}>
                        Local trace file.
                        <div style={{ fontFamily: "monospace", color: "#888", marginTop: "4px" }}>/Users/gal/.picode/userdata/logs</div>
                      </div>
                    } 
                    control={<button style={btnStyle}>Open logs folder</button>} 
                  />
                </SettingsSection>
              </>
            )}

            {activeTab === "connections" && (
              <div style={{ color: "#888", fontSize: "0.9rem", textAlign: "center", padding: "40px" }}>
                Connections are configured elsewhere.
              </div>
            )}

            {activeTab === "archive" && (
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "8px" }}>Archived Threads</div>
                {archivedSessions.length === 0 ? (
                  <div style={{ color: "#888", fontSize: "0.9rem", textAlign: "center", padding: "40px", background: "rgba(255,255,255,0.02)", border: "1px dashed #333", borderRadius: "12px" }}>
                    No archived threads found.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "#222", border: "1px solid #222", borderRadius: "12px", overflow: "hidden" }}>
                    {archivedSessions.map(({ workspaceId, workspaceName, session }) => (
                      <div key={session.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: "#0f0f0f" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "#fff" }}>{session.title}</div>
                          <div style={{ fontSize: "0.75rem", color: "#666" }}>{workspaceName} • Archived on {new Date(session.archivedAt).toLocaleDateString()}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <button 
                            onClick={() => restoreSession(workspaceId, session.id)}
                            style={{ ...btnStyle, display: "flex", alignItems: "center", gap: "6px", borderColor: "#333", padding: "6px 10px" }}
                          >
                            <RefreshCw size={14} />
                            Restore
                          </button>
                          <button 
                            onClick={() => {
                              if (confirm(`Delete "${session.title}" permanently?`)) {
                                deleteSession(workspaceId, session.id);
                              }
                            }}
                            style={{ ...btnStyle, display: "flex", alignItems: "center", gap: "6px", borderColor: "#333", color: "#f87171", padding: "6px 10px" }}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
      <style>{`
        .setting-row:last-child {
          border-bottom: none !important;
        }
      `}</style>
    </div>
  );
}
