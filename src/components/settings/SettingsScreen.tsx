import { ArrowLeft, Monitor, Shield, Zap, Globe } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { openPath } from "../../lib/tauri";
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
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [runtimeInputValue, setRuntimeInputValue] = useState("");
  const state = useAppStore((store) => store.state);
  const updatePreferences = useAppStore((store) => store.updatePreferences);
  const updateWorkspaceSettings = useAppStore(
    (store) => store.updateWorkspaceSettings,
  );
  const refreshRuntimeCatalog = useAppStore(
    (store) => store.refreshRuntimeCatalog,
  );
  const startProviderLogin = useAppStore((store) => store.startProviderLogin);
  const saveProviderApiKey = useAppStore((store) => store.saveProviderApiKey);
  const logoutProvider = useAppStore((store) => store.logoutProvider);
  const submitRuntimeInput = useAppStore((store) => store.submitRuntimeInput);
  const clearRuntimeUi = useAppStore((store) => store.clearRuntimeUi);
  const pendingRuntimeInput = useAppStore((store) => store.pendingRuntimeInput);
  const pendingBrowserAuth = useAppStore((store) => store.pendingBrowserAuth);
  const runtimeGlobalStatus = useAppStore((store) => store.runtimeGlobalStatus);
  const runtimeGlobalError = useAppStore((store) => store.runtimeGlobalError);

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

  const activeProvider = activeWorkspace
    ? state.providers.find(
        (provider) => provider.id === activeWorkspace.providerId,
      )
    : null;

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
              <Zap size={18} />
              <h2 style={{ fontSize: "1rem", margin: 0, color: "var(--text)" }}>
                Runtime Providers
              </h2>
            </div>

            {(runtimeGlobalStatus || runtimeGlobalError) && (
              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  padding: "14px 16px",
                  borderRadius: "10px",
                  background: "var(--surface-elevated)",
                  border: "1px solid var(--line)",
                }}
              >
                {runtimeGlobalStatus && (
                  <div
                    style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}
                  >
                    {runtimeGlobalStatus}
                  </div>
                )}
                {runtimeGlobalError && (
                  <div style={{ fontSize: "0.85rem", color: "#f87171" }}>
                    {runtimeGlobalError}
                  </div>
                )}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "20px",
              }}
            >
              <label style={{ display: "grid", gap: "8px" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                  Active Provider
                </span>
                <select
                  style={inputStyle}
                  value={activeWorkspace.providerId}
                  onChange={(event) => {
                    const provider = state.providers.find(
                      (item) => item.id === event.target.value,
                    );
                    void updateWorkspaceSettings({
                      workspaceId: activeWorkspace.id,
                      approvalMode: activeWorkspace.approvalMode,
                      providerId: event.target.value,
                      modelId:
                        provider?.models.find((model) => model.available)?.id ??
                        provider?.models[0]?.id ??
                        activeWorkspace.modelId,
                      effort: activeWorkspace.effort,
                      fastMode: activeWorkspace.fastMode,
                      policy: activeWorkspace.policy,
                    });
                  }}
                >
                  {state.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                      {provider.available ? "" : " (setup required)"}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: "8px" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                  Active Model
                </span>
                <select
                  style={inputStyle}
                  value={activeWorkspace.modelId}
                  onChange={(event) =>
                    void updateWorkspaceSettings({
                      workspaceId: activeWorkspace.id,
                      approvalMode: activeWorkspace.approvalMode,
                      providerId: activeWorkspace.providerId,
                      modelId: event.target.value,
                      effort: activeWorkspace.effort,
                      fastMode: activeWorkspace.fastMode,
                      policy: activeWorkspace.policy,
                    })
                  }
                >
                  {(activeProvider?.models ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                      {model.available ? "" : " (unavailable)"}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gap: "16px" }}>
              {state.providers.map((provider) => {
                const isActiveProvider =
                  activeWorkspace.providerId === provider.id;
                const browserStep =
                  pendingBrowserAuth?.providerId === provider.id;
                const inputStep =
                  pendingRuntimeInput?.providerId === provider.id;

                return (
                  <div
                    key={provider.id}
                    style={{
                      display: "grid",
                      gap: "14px",
                      padding: "18px",
                      borderRadius: "12px",
                      background: "var(--surface-elevated)",
                      border: `1px solid ${
                        isActiveProvider ? "var(--accent)" : "var(--line)"
                      }`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <div style={{ display: "grid", gap: "6px" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>
                            {provider.label}
                          </div>
                          <span
                            style={{
                              fontSize: "0.72rem",
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                              color: provider.available
                                ? "#4ade80"
                                : "var(--text-muted)",
                            }}
                          >
                            {provider.status.replaceAll("_", " ")}
                          </span>
                        </div>
                        {provider.reason && (
                          <div
                            style={{
                              fontSize: "0.82rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            {provider.reason}
                          </div>
                        )}
                      </div>
                      <button
                        className="nav-item"
                        style={{ justifyContent: "center" }}
                        onClick={() => void refreshRuntimeCatalog()}
                      >
                        Refresh
                      </button>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "8px",
                      }}
                    >
                      {provider.models.map((model) => (
                        <span
                          key={model.id}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "999px",
                            fontSize: "0.78rem",
                            border: "1px solid var(--line)",
                            color: model.available
                              ? "var(--text)"
                              : "var(--text-muted)",
                          }}
                        >
                          {model.label}
                        </span>
                      ))}
                    </div>

                    {provider.authKind === "oauth" && (
                      <div
                        style={{
                          display: "flex",
                          gap: "10px",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          className="nav-item"
                          style={{ justifyContent: "center" }}
                          onClick={() => void startProviderLogin(provider.id)}
                        >
                          {provider.available ? "Reconnect" : "Connect"}
                        </button>
                        {provider.available && (
                          <button
                            className="nav-item"
                            style={{ justifyContent: "center" }}
                            onClick={() => void logoutProvider(provider.id)}
                          >
                            Disconnect
                          </button>
                        )}
                      </div>
                    )}

                    {provider.authKind === "api-key" && (
                      <div
                        style={{
                          display: "flex",
                          gap: "10px",
                          flexWrap: "wrap",
                        }}
                      >
                        <input
                          style={{ ...inputStyle, flex: 1, minWidth: "240px" }}
                          type="password"
                          placeholder={`${provider.label} API key`}
                          value={apiKeys[provider.id] ?? ""}
                          onChange={(event) =>
                            setApiKeys((current) => ({
                              ...current,
                              [provider.id]: event.target.value,
                            }))
                          }
                        />
                        <button
                          className="nav-item"
                          style={{ justifyContent: "center" }}
                          onClick={() =>
                            void saveProviderApiKey(
                              provider.id,
                              apiKeys[provider.id] ?? "",
                            )
                          }
                        >
                          Save Key
                        </button>
                        {provider.available && (
                          <button
                            className="nav-item"
                            style={{ justifyContent: "center" }}
                            onClick={() => void logoutProvider(provider.id)}
                          >
                            Remove Key
                          </button>
                        )}
                      </div>
                    )}

                    {browserStep && (
                      <div
                        style={{
                          display: "grid",
                          gap: "10px",
                          padding: "14px",
                          borderRadius: "10px",
                          border: "1px solid var(--line)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.85rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          {pendingBrowserAuth.instructions ??
                            `Open the ${provider.label} login flow in your browser.`}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: "10px",
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            className="nav-item"
                            style={{ justifyContent: "center" }}
                            onClick={() =>
                              void openPath(pendingBrowserAuth.url)
                            }
                          >
                            Open Browser
                          </button>
                          <button
                            className="nav-item"
                            style={{ justifyContent: "center" }}
                            onClick={() => clearRuntimeUi()}
                          >
                            Hide
                          </button>
                        </div>
                      </div>
                    )}

                    {inputStep && (
                      <div
                        style={{
                          display: "grid",
                          gap: "10px",
                          padding: "14px",
                          borderRadius: "10px",
                          border: "1px solid var(--line)",
                        }}
                      >
                        <div style={{ display: "grid", gap: "6px" }}>
                          <div style={{ fontWeight: 600 }}>
                            {pendingRuntimeInput.title}
                          </div>
                          <div
                            style={{
                              fontSize: "0.85rem",
                              color: "var(--text-muted)",
                            }}
                          >
                            {pendingRuntimeInput.message}
                          </div>
                        </div>
                        <input
                          style={inputStyle}
                          placeholder={pendingRuntimeInput.placeholder}
                          value={runtimeInputValue}
                          onChange={(event) =>
                            setRuntimeInputValue(event.target.value)
                          }
                        />
                        <div
                          style={{
                            display: "flex",
                            gap: "10px",
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            className="nav-item"
                            style={{ justifyContent: "center" }}
                            onClick={() => {
                              void submitRuntimeInput({
                                requestId: pendingRuntimeInput.requestId,
                                value: runtimeInputValue,
                              });
                              setRuntimeInputValue("");
                            }}
                          >
                            Submit
                          </button>
                          <button
                            className="nav-item"
                            style={{ justifyContent: "center" }}
                            onClick={() => {
                              void submitRuntimeInput({
                                requestId: pendingRuntimeInput.requestId,
                                cancelled: true,
                              });
                              setRuntimeInputValue("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

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
                  <option value="auto-accept-edits">Auto-Accept Edits</option>
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
