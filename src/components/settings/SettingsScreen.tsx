import { ArrowLeft, Monitor, Shield, Zap, Globe } from "lucide-react";
import { Link } from "react-router-dom";
import { useAppStore } from "../../state/useAppStore";
import { cn } from "../../lib/cn";
import type { ApprovalMode } from "../../domains/types";

const themes = [
  "dark",
  "light",
  "catppuccin",
  "nord",
  "gruvbox",
  "solarized",
] as const;

export function SettingsScreen() {
  const state = useAppStore((store) => store.state);
  const updatePreferences = useAppStore((store) => store.updatePreferences);
  const updateWorkspaceSettings = useAppStore(
    (store) => store.updateWorkspaceSettings,
  );

  if (!state) {
    return null;
  }

  const activeWorkspace = state.workspaces.find(
    (item) => item.id === state.activeWorkspaceId,
  );

  const cardStyle: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "12px",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--surface-elevated)",
    border: "1px solid var(--line)",
    borderRadius: "8px",
    padding: "10px 12px",
    color: "inherit",
    fontSize: "0.9rem",
    outline: "none",
    width: "100%",
  };

  return (
    <div
      className="main-pane"
      style={{ overflowY: "auto", paddingBottom: "80px" }}
    >
      <header className="main-pane__header">
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <Link className="icon-button" to="/" aria-label="Back">
            <ArrowLeft size={18} />
          </Link>
          <div className="main-pane__title">
            <h1>Settings</h1>
          </div>
        </div>
      </header>

      <div
        style={{
          maxWidth: "800px",
          margin: "40px auto",
          width: "100%",
          padding: "0 24px",
          display: "flex",
          flexDirection: "column",
          gap: "32px",
        }}
      >
        <section style={cardStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              color: "var(--text-dim)",
              marginBottom: "4px",
            }}
          >
            <Monitor size={18} />
            <h2 style={{ fontSize: "1rem", margin: 0, color: "var(--text)" }}>
              Appearance
            </h2>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "0.9rem",
              color: "var(--text-muted)",
            }}
          >
            Choose your preferred interface theme.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: "8px",
            }}
          >
            {themes.map((theme) => (
              <button
                key={theme}
                className={cn(
                  "nav-item",
                  state.preferences.theme === theme && "nav-item--active",
                )}
                style={{
                  justifyContent: "center",
                  textTransform: "capitalize",
                }}
                onClick={() =>
                  updatePreferences({ ...state.preferences, theme })
                }
              >
                {theme}
              </button>
            ))}
          </div>
        </section>

        {activeWorkspace && (
          <section style={cardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "var(--text-dim)",
                marginBottom: "4px",
              }}
            >
              <Shield size={18} />
              <h2 style={{ fontSize: "1rem", margin: 0, color: "var(--text)" }}>
                Workspace Policy: {activeWorkspace.name}
              </h2>
            </div>

            <div style={{ display: "grid", gap: "24px" }}>
              <label style={{ display: "grid", gap: "8px" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                  Approval Mode
                </span>
                <select
                  style={inputStyle}
                  value={activeWorkspace.approvalMode}
                  onChange={(event) =>
                    void updateWorkspaceSettings({
                      workspaceId: activeWorkspace.id,
                      approvalMode: event.target.value as ApprovalMode,
                      providerId: activeWorkspace.providerId,
                      modelId: activeWorkspace.modelId,
                      policy: activeWorkspace.policy,
                    })
                  }
                >
                  <option value="supervised">Supervised (Recommended)</option>
                  <option value="full-access">Full Access (Aventurous)</option>
                </select>
              </label>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px",
                }}
              >
                <label style={{ display: "grid", gap: "8px" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    Allowed Paths
                  </span>
                  <textarea
                    style={{
                      ...inputStyle,
                      minHeight: "100px",
                      resize: "vertical",
                    }}
                    placeholder="/path/to/project"
                    value={activeWorkspace.policy.allowedPaths.join("\n")}
                    onChange={(event) =>
                      void updateWorkspaceSettings({
                        workspaceId: activeWorkspace.id,
                        approvalMode: activeWorkspace.approvalMode,
                        providerId: activeWorkspace.providerId,
                        modelId: activeWorkspace.modelId,
                        policy: {
                          ...activeWorkspace.policy,
                          allowedPaths: event.target.value
                            .split("\n")
                            .map((i) => i.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                </label>
                <label style={{ display: "grid", gap: "8px" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    Allowed Commands
                  </span>
                  <textarea
                    style={{
                      ...inputStyle,
                      minHeight: "100px",
                      resize: "vertical",
                    }}
                    placeholder="npm start"
                    value={activeWorkspace.policy.allowedCommands.join("\n")}
                    onChange={(event) =>
                      void updateWorkspaceSettings({
                        workspaceId: activeWorkspace.id,
                        approvalMode: activeWorkspace.approvalMode,
                        providerId: activeWorkspace.providerId,
                        modelId: activeWorkspace.modelId,
                        policy: {
                          ...activeWorkspace.policy,
                          allowedCommands: event.target.value
                            .split("\n")
                            .map((i) => i.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                </label>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px",
                  background: "var(--surface-elevated)",
                  borderRadius: "8px",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "12px" }}
                >
                  <Globe size={18} className="text-dim" />
                  <div>
                    <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>
                      Network Access
                    </div>
                    <div
                      style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}
                    >
                      Allow Pi to make external web requests
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  style={{
                    width: "20px",
                    height: "20px",
                    cursor: "pointer",
                    accentColor: "var(--accent)",
                  }}
                  checked={activeWorkspace.policy.networkEnabled}
                  onChange={(event) =>
                    void updateWorkspaceSettings({
                      workspaceId: activeWorkspace.id,
                      approvalMode: activeWorkspace.approvalMode,
                      providerId: activeWorkspace.providerId,
                      modelId: activeWorkspace.modelId,
                      policy: {
                        ...activeWorkspace.policy,
                        networkEnabled: event.target.checked,
                      },
                    })
                  }
                />
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
