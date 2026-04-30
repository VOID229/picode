import {
  ArrowLeft,
  SlidersHorizontal,
  Link as LinkIcon,
  Archive,
  Keyboard,
  RotateCcw,
  Trash2,
  RefreshCw,
  Palette,
  Check,
} from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  themeDefinitions,
  defaultCustomColors,
  colorLabels,
  type ThemeColors,
} from "../../lib/themes";
import type { ThemeId, CustomThemeColors } from "../../domains/types";
import { Link, useNavigate } from "react-router-dom";
import {
  checkForAppUpdate,
  getAppPaths,
  installAppUpdate,
  openPath,
  restartApp,
} from "../../lib/tauri";
import {
  eventToShortcut,
  formatShortcut,
  getShortcutBinding,
  shortcutDefinitions,
  type ShortcutId,
} from "../../lib/keyboardShortcuts";
import { useAppStore } from "../../state/useAppStore";
import type { AppPaths } from "../../domains/types";

let lastSettingsTab = "general";

function Toggle({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        width: "36px",
        height: "20px",
        borderRadius: "10px",
        background: checked ? "var(--accent)" : "var(--surface-strong)",
        position: "relative",
        cursor: "pointer",
        transition: "background 0.2s",
      }}
    >
      <div
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          background: "var(--text)",
          position: "absolute",
          top: "2px",
          left: checked ? "18px" : "2px",
          transition: "left 0.2s",
        }}
      />
    </div>
  );
}

function SettingRow({
  label,
  description,
  control,
}: {
  label: React.ReactNode;
  description: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div
      className="setting-row"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "16px 20px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div style={{ maxWidth: "70%" }}>
        <div
          style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text)" }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            marginTop: "4px",
            lineHeight: "1.4",
          }}
        >
          {description}
        </div>
      </div>
      <div>{control}</div>
    </div>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div
          style={{ width: "16px", height: "1px", background: "var(--line)" }}
        />
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 600,
            color: "var(--text-dim)",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </span>
      </div>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function ShortcutRecorder({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string) => void;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }

      const next = eventToShortcut(event);
      if (next) {
        onChange(next);
        setRecording(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onChange, recording]);

  return (
    <button
      onBlur={() => setRecording(false)}
      onClick={() => setRecording(true)}
      style={{
        minWidth: "112px",
        background: "transparent",
        color: recording ? "var(--text)" : "var(--text-muted)",
        border: "none",
        padding: "6px 8px",
        outline: "none",
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: "0.8rem",
        textAlign: "right",
      }}
      type="button"
    >
      {recording ? "Press keys" : formatShortcut(value)}
    </button>
  );
}

function ShortcutActionButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseUp={() => setPressed(false)}
      style={{
        background: hovered ? "var(--accent-soft)" : "transparent",
        color: pressed ? "var(--text)" : "var(--text-muted)",
        border: "1px solid var(--line)",
        padding: "6px 10px",
        borderRadius: "6px",
        outline: "none",
        cursor: "pointer",
        fontSize: "0.8rem",
        transform: pressed ? "translateY(1px)" : "translateY(0)",
        transition: "background 0.15s, color 0.15s, transform 0.08s",
      }}
      type="button"
    >
      {children}
    </button>
  );
}

function ThemePicker({
  currentTheme,
  customColors,
  updatePreferences,
  state,
}: {
  currentTheme: ThemeId;
  customColors?: CustomThemeColors;
  updatePreferences: (prefs: any) => Promise<void>;
  state: any;
}) {
  const [editingCustom, setEditingCustom] = useState<CustomThemeColors>(
    customColors ?? defaultCustomColors,
  );

  useEffect(() => {
    if (currentTheme === "custom" && customColors) {
      setEditingCustom(customColors);
    }
  }, [currentTheme, customColors]);

  const handleSelectTheme = useCallback(
    (themeId: ThemeId) => {
      if (!state) return;
      const next = { ...state.preferences, theme: themeId };
      if (themeId === "custom") {
        next.customThemeColors = editingCustom;
      }
      void updatePreferences(next);
    },
    [state, updatePreferences, editingCustom],
  );

  const handleCustomColorChange = useCallback(
    (key: keyof ThemeColors, value: string) => {
      const next = { ...editingCustom, [key]: value };
      setEditingCustom(next);
      if (state && currentTheme === "custom") {
        void updatePreferences({
          ...state.preferences,
          theme: "custom",
          customThemeColors: next,
        });
      }
    },
    [editingCustom, state, updatePreferences, currentTheme],
  );

  const allThemes = [
    ...themeDefinitions,
    {
      id: "custom" as ThemeId,
      label: "Custom",
      isDark: true,
      colors: editingCustom,
    },
  ];

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "32px",
      }}
    >
      <SettingsSection title="THEME">
        <div
          style={{
            padding: "20px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "16px",
          }}
        >
          {allThemes.map((theme) => {
            const isSelected = currentTheme === theme.id;
            const c = theme.colors;
            return (
              <button
                key={theme.id}
                onClick={() => handleSelectTheme(theme.id)}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  padding: "16px",
                  borderRadius: "12px",
                  border: isSelected
                    ? `2px solid ${c.accent}`
                    : "1px solid rgba(255,255,255,0.08)",
                  background: c.surface,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "border-color 0.2s, transform 0.15s",
                  transform: isSelected ? "scale(1.02)" : "scale(1)",
                }}
              >
                {isSelected && (
                  <div
                    style={{
                      position: "absolute",
                      top: "10px",
                      right: "10px",
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      background: c.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Check size={13} color={c.bg} strokeWidth={3} />
                  </div>
                )}

                {/* Preview bar */}
                <div
                  style={{
                    display: "flex",
                    height: "28px",
                    borderRadius: "6px",
                    overflow: "hidden",
                    border: `1px solid ${c.line}`,
                  }}
                >
                  <div
                    style={{ flex: 1, background: c.bg }}
                    title={`Background: ${c.bg}`}
                  />
                  <div
                    style={{ flex: 1, background: c.surface }}
                    title={`Surface: ${c.surface}`}
                  />
                  <div
                    style={{ flex: 1, background: c.surfaceElevated }}
                    title={`Surface Elevated: ${c.surfaceElevated}`}
                  />
                  <div
                    style={{ flex: 1, background: c.accent }}
                    title={`Accent: ${c.accent}`}
                  />
                  <div
                    style={{ flex: 1, background: c.text }}
                    title={`Text: ${c.text}`}
                  />
                  <div
                    style={{ flex: 1, background: c.success }}
                    title={`Success: ${c.success}`}
                  />
                  <div
                    style={{ flex: 0.5, background: c.danger }}
                    title={`Danger: ${c.danger}`}
                  />
                </div>

                <div
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    color: c.text,
                  }}
                >
                  {theme.label}
                </div>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      {/* Color Details */}
      <SettingsSection title="COLOR REFERENCE">
        <div
          style={{
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div
            style={{
              fontSize: "0.84rem",
              color: "var(--text-muted)",
              marginBottom: "4px",
            }}
          >
            {currentTheme === "custom"
              ? "Edit any color below. Changes apply in real time."
              : `Hex values for the ${allThemes.find((t) => t.id === currentTheme)?.label ?? ""} theme.`}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "8px",
            }}
          >
            {(Object.keys(colorLabels) as Array<keyof ThemeColors>).map(
              (key) => {
                const colors =
                  currentTheme === "custom"
                    ? editingCustom
                    : (allThemes.find((t) => t.id === currentTheme)?.colors ??
                      editingCustom);
                const value = colors[key];
                const isEditing = currentTheme === "custom";

                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: "var(--surface)",
                      border: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "6px",
                        background: value,
                        border: "1px solid rgba(255,255,255,0.1)",
                        flexShrink: 0,
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.76rem",
                          fontWeight: 600,
                          color: "var(--text-muted)",
                        }}
                      >
                        {colorLabels[key]}
                      </span>
                      {isEditing ? (
                        <input
                          type="text"
                          value={value}
                          onChange={(e) =>
                            handleCustomColorChange(key, e.target.value)
                          }
                          style={{
                            width: "100%",
                            background: "rgba(0,0,0,0.3)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: "4px",
                            padding: "2px 6px",
                            color: "var(--text)",
                            fontSize: "0.78rem",
                            fontFamily: "monospace",
                            outline: "none",
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            fontSize: "0.78rem",
                            fontFamily: "monospace",
                            color: "var(--text-dim)",
                          }}
                        >
                          {value}
                        </span>
                      )}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

export function SettingsScreen() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(lastSettingsTab);

  useEffect(() => {
    lastSettingsTab = activeTab;
  }, [activeTab]);
  const [piBinaryInput, setPiBinaryInput] = useState("");
  const [appPaths, setAppPaths] = useState<AppPaths | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateAvailableVersion, setUpdateAvailableVersion] = useState<
    string | null
  >(null);
  const [updateInstalled, setUpdateInstalled] = useState(false);

  const controlStyle = {
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--line)",
    padding: "8px 12px",
    borderRadius: "6px",
    outline: "none",
    minWidth: "160px",
    fontSize: "0.85rem",
  };

  const btnStyle = {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--line)",
    padding: "6px 12px",
    borderRadius: "6px",
    outline: "none",
    cursor: "pointer",
    fontSize: "0.85rem",
  };

  const state = useAppStore((store) => store.state);
  const runtimeInstall = useAppStore((store) => store.runtimeInstall);
  const runtimeGlobalError = useAppStore((store) => store.runtimeGlobalError);
  const workspaceCatalogs = useAppStore((store) => store.workspaceCatalogs);
  const workspaceCatalogErrors = useAppStore(
    (store) => store.workspaceCatalogErrors,
  );
  const restoreSession = useAppStore((store) => store.restoreSession);
  const deleteSession = useAppStore((store) => store.deleteSession);
  const updatePreferences = useAppStore((store) => store.updatePreferences);
  const addToast = useAppStore((store) => store.addToast);
  const refreshRuntimeHealth = useAppStore(
    (store) => store.refreshRuntimeHealth,
  );

  const setShortcut = (id: ShortcutId, value: string | null | undefined) => {
    if (!state) {
      return;
    }

    const shortcuts = { ...(state.preferences.shortcuts ?? {}) };
    if (value === undefined) {
      delete shortcuts[id];
    } else {
      shortcuts[id] = value;
    }

    void updatePreferences({
      ...state.preferences,
      shortcuts,
    });
  };

  const restoreAllShortcuts = () => {
    if (!state) {
      return;
    }

    void updatePreferences({
      ...state.preferences,
      shortcuts: {},
    });
  };

  const activeWorkspace = useMemo(
    () =>
      state?.workspaces.find(
        (workspace) => workspace.id === state.activeWorkspaceId,
      ) ?? null,
    [state],
  );

  useEffect(() => {
    setPiBinaryInput(state?.preferences.piBinaryPath ?? "");
  }, [state?.preferences.piBinaryPath]);

  useEffect(() => {
    let cancelled = false;

    void getAppPaths()
      .then((paths) => {
        if (!cancelled) {
          setAppPaths(paths);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppPaths(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        navigate("/");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  const commitPiBinaryOverride = async (nextValue: string) => {
    if (!state) {
      return;
    }

    const trimmed = nextValue.trim();
    const current = state.preferences.piBinaryPath ?? "";
    if (trimmed === current) {
      return;
    }

    await updatePreferences({
      ...state.preferences,
      piBinaryPath: trimmed || undefined,
    });
  };

  const archivedSessions = useMemo(() => {
    if (!state) return [];
    const archived: Array<{
      workspaceId: string;
      workspaceName: string;
      session: any;
    }> = [];
    state.workspaces.forEach((workspace) => {
      workspace.sessions.forEach((session) => {
        if (session.archivedAt) {
          archived.push({
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            session,
          });
        }
      });
    });
    return archived.sort((a, b) => {
      const dateA = a.session.archivedAt
        ? new Date(a.session.archivedAt).getTime()
        : 0;
      const dateB = b.session.archivedAt
        ? new Date(b.session.archivedAt).getTime()
        : 0;
      return dateB - dateA;
    });
  }, [state]);

  const titleProviders = useMemo(() => {
    if (!state) {
      return [];
    }

    const activeCatalog = activeWorkspace
      ? (workspaceCatalogs[activeWorkspace.id] ?? [])
      : [];
    return activeCatalog.length > 0 ? activeCatalog : state.providers;
  }, [activeWorkspace, state, workspaceCatalogs]);

  const titleProvider =
    titleProviders.find(
      (provider) => provider.id === state?.preferences.titleModelProviderId,
    ) ??
    titleProviders.find((provider) => provider.id === "openai-codex") ??
    titleProviders[0];
  const titleModels = titleProvider?.models ?? [];
  const titleModel =
    titleModels.find((model) => model.id === state?.preferences.titleModelId) ??
    titleModels.find((model) => model.id === "gpt-5.4-mini") ??
    titleModels[0];
  const titleFallbackProvider =
    titleProviders.find(
      (provider) =>
        provider.id === state?.preferences.titleModelFallbackProviderId,
    ) ??
    titleProviders.find((provider) => provider.id === "openai-codex") ??
    titleProviders[0];
  const titleFallbackModels = titleFallbackProvider?.models ?? [];
  const titleFallbackModel =
    titleFallbackModels.find(
      (model) => model.id === state?.preferences.titleModelFallbackId,
    ) ??
    titleFallbackModels.find((model) => model.id === "gpt-5.4") ??
    titleFallbackModels[0];
  const gitMessageProvider =
    titleProviders.find(
      (provider) =>
        provider.id === state?.preferences.gitMessageModelProviderId,
    ) ??
    titleProviders.find((provider) => provider.id === "openai-codex") ??
    titleProviders[0];
  const gitMessageModels = gitMessageProvider?.models ?? [];
  const gitMessageModel =
    gitMessageModels.find(
      (model) => model.id === state?.preferences.gitMessageModelId,
    ) ??
    gitMessageModels.find((model) => model.id === "gpt-5.4-mini") ??
    gitMessageModels[0];
  const gitMessageFallbackProvider =
    titleProviders.find(
      (provider) =>
        provider.id === state?.preferences.gitMessageModelFallbackProviderId,
    ) ??
    titleProviders.find((provider) => provider.id === "openai-codex") ??
    titleProviders[0];
  const gitMessageFallbackModels = gitMessageFallbackProvider?.models ?? [];
  const gitMessageFallbackModel =
    gitMessageFallbackModels.find(
      (model) => model.id === state?.preferences.gitMessageModelFallbackId,
    ) ??
    gitMessageFallbackModels.find((model) => model.id === "gpt-5.4") ??
    gitMessageFallbackModels[0];

  useEffect(() => {
    if (!state || !titleProvider || !titleModel) {
      return;
    }

    if (
      state.preferences.titleModelProviderId === titleProvider.id &&
      state.preferences.titleModelId === titleModel.id
    ) {
      return;
    }

    void updatePreferences({
      ...state.preferences,
      titleModelProviderId: titleProvider.id,
      titleModelId: titleModel.id,
    });
  }, [state, titleModel, titleProvider, updatePreferences]);

  useEffect(() => {
    if (!state || !titleFallbackProvider || !titleFallbackModel) {
      return;
    }

    if (
      state.preferences.titleModelFallbackProviderId ===
        titleFallbackProvider.id &&
      state.preferences.titleModelFallbackId === titleFallbackModel.id
    ) {
      return;
    }

    void updatePreferences({
      ...state.preferences,
      titleModelFallbackProviderId: titleFallbackProvider.id,
      titleModelFallbackId: titleFallbackModel.id,
    });
  }, [state, titleFallbackModel, titleFallbackProvider, updatePreferences]);

  useEffect(() => {
    if (!state || !gitMessageProvider || !gitMessageModel) {
      return;
    }
    if (
      state.preferences.gitMessageModelProviderId === gitMessageProvider.id &&
      state.preferences.gitMessageModelId === gitMessageModel.id
    ) {
      return;
    }
    void updatePreferences({
      ...state.preferences,
      gitMessageModelProviderId: gitMessageProvider.id,
      gitMessageModelId: gitMessageModel.id,
    });
  }, [gitMessageModel, gitMessageProvider, state, updatePreferences]);

  useEffect(() => {
    if (!state || !gitMessageFallbackProvider || !gitMessageFallbackModel) {
      return;
    }
    if (
      state.preferences.gitMessageModelFallbackProviderId ===
        gitMessageFallbackProvider.id &&
      state.preferences.gitMessageModelFallbackId === gitMessageFallbackModel.id
    ) {
      return;
    }
    void updatePreferences({
      ...state.preferences,
      gitMessageModelFallbackProviderId: gitMessageFallbackProvider.id,
      gitMessageModelFallbackId: gitMessageFallbackModel.id,
    });
  }, [
    gitMessageFallbackModel,
    gitMessageFallbackProvider,
    state,
    updatePreferences,
  ]);

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100vh",
        backgroundColor: "var(--bg)",
        color: "var(--text)",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: "260px",
          borderRight: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--surface)",
        }}
      >
        <div
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
            <span
              style={{
                fontWeight: 600,
                color: "var(--text)",
                fontSize: "1.05rem",
              }}
            >
              picode
            </span>
            <span
              style={{
                fontSize: "0.6rem",
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: "var(--text-muted)",
                background: "var(--surface-elevated)",
                padding: "2px 6px",
                borderRadius: "10px",
                marginTop: "1px",
              }}
            >
              {state?.preferences.updateChannel === "nightly"
                ? "NIGHTLY"
                : "ALPHA"}
            </span>
          </div>
        </div>

        <div
          style={{
            padding: "16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <div
            onClick={() => setActiveTab("general")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderRadius: "6px",
              background:
                activeTab === "general"
                  ? "var(--surface-elevated)"
                  : "transparent",
              color:
                activeTab === "general" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (activeTab !== "general") {
                e.currentTarget.style.background = "var(--surface-elevated)";
                e.currentTarget.style.color = "var(--text)";
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== "general") {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-muted)";
              }
            }}
          >
            <SlidersHorizontal size={14} />
            <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>
              General
            </span>
          </div>
          <div
            onClick={() => setActiveTab("connections")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderRadius: "6px",
              background:
                activeTab === "connections"
                  ? "var(--surface-elevated)"
                  : "transparent",
              color:
                activeTab === "connections"
                  ? "var(--text)"
                  : "var(--text-muted)",
              cursor: "pointer",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (activeTab !== "connections") {
                e.currentTarget.style.background = "var(--surface-elevated)";
                e.currentTarget.style.color = "var(--text)";
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== "connections") {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-muted)";
              }
            }}
          >
            <LinkIcon size={14} />
            <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>
              Connections
            </span>
          </div>
          <div
            onClick={() => setActiveTab("shortcuts")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderRadius: "6px",
              background:
                activeTab === "shortcuts"
                  ? "var(--surface-elevated)"
                  : "transparent",
              color:
                activeTab === "shortcuts" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (activeTab !== "shortcuts") {
                e.currentTarget.style.background = "var(--surface-elevated)";
                e.currentTarget.style.color = "var(--text)";
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== "shortcuts") {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-muted)";
              }
            }}
          >
            <Keyboard size={14} />
            <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>
              Shortcuts
            </span>
          </div>
          <div
            onClick={() => setActiveTab("theme")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderRadius: "6px",
              background:
                activeTab === "theme"
                  ? "var(--surface-elevated)"
                  : "transparent",
              color:
                activeTab === "theme" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (activeTab !== "theme") {
                e.currentTarget.style.background = "var(--surface-elevated)";
                e.currentTarget.style.color = "var(--text)";
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== "theme") {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-muted)";
              }
            }}
          >
            <Palette size={14} />
            <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Theme</span>
          </div>
          <div
            onClick={() => setActiveTab("archive")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderRadius: "6px",
              background:
                activeTab === "archive"
                  ? "var(--surface-elevated)"
                  : "transparent",
              color:
                activeTab === "archive" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (activeTab !== "archive") {
                e.currentTarget.style.background = "var(--surface-elevated)";
                e.currentTarget.style.color = "var(--text)";
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== "archive") {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-muted)";
              }
            }}
          >
            <Archive size={14} />
            <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>
              Archive
            </span>
          </div>
        </div>

        <div style={{ marginTop: "auto", padding: "16px" }}>
          <Link
            to="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "var(--text-muted)",
              textDecoration: "none",
              fontSize: "0.85rem",
              padding: "6px 8px",
              borderRadius: "6px",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-elevated)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            <ArrowLeft size={16} />
            Back
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <div
          style={
            {
              padding: "0 24px",
              height: "54px",
              minHeight: "54px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              WebkitAppRegion: "drag",
              borderBottom: "1px solid var(--line)",
            } as React.CSSProperties
          }
        >
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Settings
          </div>
          <button
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-elevated)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-muted)";
            }}
            style={
              {
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "transparent",
                border: "1px solid var(--line)",
                color: "var(--text-muted)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "0.75rem",
                cursor: "pointer",
                WebkitAppRegion: "no-drag",
                transition: "background 0.15s, color 0.15s",
              } as React.CSSProperties
            }
          >
            <RotateCcw size={12} />
            Restore defaults
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "40px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "800px",
              margin: "0 auto",
              display: "flex",
              flexDirection: "column",
              gap: "40px",
            }}
          >
            {activeTab === "general" && (
              <>
                <SettingsSection title="GENERAL">
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
                    label="Model selection behavior"
                    description="Choose how provider, model, and reasoning are restored when switching threads."
                    control={
                      <select
                        style={{ ...controlStyle, minWidth: "210px" }}
                        value={
                          state?.preferences.modelSelectionScope === "global"
                            ? "global"
                            : state?.preferences.threadModelMemory === "used"
                              ? "used"
                              : "selected"
                        }
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          const value = event.target.value;
                          void updatePreferences({
                            ...state.preferences,
                            modelSelectionScope:
                              value === "global" ? "global" : "thread",
                            threadModelMemory:
                              value === "used" ? "used" : "selected",
                          });
                        }}
                      >
                        <option value="selected">
                          Switch to last selected
                        </option>
                        <option value="used">Switch to last used</option>
                        <option value="global">Always global</option>
                      </select>
                    }
                  />
                  <SettingRow
                    label="Auto thread titles"
                    description="Generate a short thread title after the first successful exchange when the thread is still named New thread."
                    control={
                      <button
                        style={{
                          ...btnStyle,
                          padding: 0,
                          border: "none",
                          background: "transparent",
                        }}
                        onClick={() => {
                          if (!state) {
                            return;
                          }

                          void updatePreferences({
                            ...state.preferences,
                            autoTitleEnabled:
                              !state.preferences.autoTitleEnabled,
                          });
                        }}
                        type="button"
                      >
                        <Toggle
                          checked={state?.preferences.autoTitleEnabled ?? true}
                        />
                      </button>
                    }
                  />
                  <SettingRow
                    label="Title model provider"
                    description="Choose which provider generates automatic thread titles."
                    control={
                      <select
                        style={controlStyle}
                        value={titleProvider?.id ?? ""}
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          const nextProvider = titleProviders.find(
                            (provider) => provider.id === event.target.value,
                          );
                          const nextModelId =
                            nextProvider?.models[0]?.id ??
                            state.preferences.titleModelId;

                          void updatePreferences({
                            ...state.preferences,
                            titleModelProviderId: event.target.value,
                            titleModelId: nextModelId,
                          });
                        }}
                      >
                        {titleProviders.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    label="Title generation model"
                    description="Uses the selected provider and model for background thread naming only."
                    control={
                      <select
                        style={controlStyle}
                        value={titleModel?.id ?? ""}
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          void updatePreferences({
                            ...state.preferences,
                            titleModelProviderId:
                              titleProvider?.id ??
                              state.preferences.titleModelProviderId,
                            titleModelId: event.target.value,
                          });
                        }}
                      >
                        {titleModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    label="Fallback title model provider"
                    description="Choose a backup provider for automatic thread titles if the primary one fails."
                    control={
                      <select
                        style={controlStyle}
                        value={titleFallbackProvider?.id ?? ""}
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          const nextProvider = titleProviders.find(
                            (provider) => provider.id === event.target.value,
                          );
                          const nextModelId =
                            nextProvider?.models[0]?.id ??
                            state.preferences.titleModelFallbackId;

                          void updatePreferences({
                            ...state.preferences,
                            titleModelFallbackProviderId: event.target.value,
                            titleModelFallbackId: nextModelId,
                          });
                        }}
                      >
                        {titleProviders.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    label="Fallback title generation model"
                    description="Used if the primary title model errors or returns no usable title."
                    control={
                      <select
                        style={controlStyle}
                        value={titleFallbackModel?.id ?? ""}
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          void updatePreferences({
                            ...state.preferences,
                            titleModelFallbackProviderId:
                              titleFallbackProvider?.id ??
                              state.preferences.titleModelFallbackProviderId,
                            titleModelFallbackId: event.target.value,
                          });
                        }}
                      >
                        {titleFallbackModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    label="Title generation effort"
                    description="Controls the reasoning depth used for automatic thread naming."
                    control={
                      <select
                        style={controlStyle}
                        value={state?.preferences.titleModelEffort ?? "high"}
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          void updatePreferences({
                            ...state.preferences,
                            titleModelEffort: event.target.value,
                          });
                        }}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="xhigh">XHigh</option>
                      </select>
                    }
                  />
                  <SettingRow
                    label="Auto git messages"
                    description="Generate commit messages and pull request text when git modal fields are left blank."
                    control={
                      <button
                        style={{
                          ...btnStyle,
                          padding: 0,
                          border: "none",
                          background: "transparent",
                        }}
                        onClick={() => {
                          if (!state) {
                            return;
                          }

                          void updatePreferences({
                            ...state.preferences,
                            autoGitMessagesEnabled:
                              !state.preferences.autoGitMessagesEnabled,
                          });
                        }}
                        type="button"
                      >
                        <Toggle
                          checked={
                            state?.preferences.autoGitMessagesEnabled ?? true
                          }
                        />
                      </button>
                    }
                  />
                  <SettingRow
                    label="Git message model provider"
                    description="Choose which provider generates commit and pull request messages."
                    control={
                      <select
                        style={controlStyle}
                        value={gitMessageProvider?.id ?? ""}
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          const nextProvider = titleProviders.find(
                            (provider) => provider.id === event.target.value,
                          );
                          const nextModelId =
                            nextProvider?.models[0]?.id ??
                            state.preferences.gitMessageModelId;

                          void updatePreferences({
                            ...state.preferences,
                            gitMessageModelProviderId: event.target.value,
                            gitMessageModelId: nextModelId,
                          });
                        }}
                      >
                        {titleProviders.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    label="Git message model"
                    description="Uses the selected provider and model for background git text generation only."
                    control={
                      <select
                        style={controlStyle}
                        value={gitMessageModel?.id ?? ""}
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          void updatePreferences({
                            ...state.preferences,
                            gitMessageModelProviderId:
                              gitMessageProvider?.id ??
                              state.preferences.gitMessageModelProviderId,
                            gitMessageModelId: event.target.value,
                          });
                        }}
                      >
                        {gitMessageModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    label="Fallback git model provider"
                    description="Choose a backup provider for automatic git text if the primary one fails."
                    control={
                      <select
                        style={controlStyle}
                        value={gitMessageFallbackProvider?.id ?? ""}
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          const nextProvider = titleProviders.find(
                            (provider) => provider.id === event.target.value,
                          );
                          const nextModelId =
                            nextProvider?.models[0]?.id ??
                            state.preferences.gitMessageModelFallbackId;

                          void updatePreferences({
                            ...state.preferences,
                            gitMessageModelFallbackProviderId:
                              event.target.value,
                            gitMessageModelFallbackId: nextModelId,
                          });
                        }}
                      >
                        {titleProviders.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    label="Fallback git model"
                    description="Used if the primary git message model errors or returns no usable text."
                    control={
                      <select
                        style={controlStyle}
                        value={gitMessageFallbackModel?.id ?? ""}
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          void updatePreferences({
                            ...state.preferences,
                            gitMessageModelFallbackProviderId:
                              gitMessageFallbackProvider?.id ??
                              state.preferences
                                .gitMessageModelFallbackProviderId,
                            gitMessageModelFallbackId: event.target.value,
                          });
                        }}
                      >
                        {gitMessageFallbackModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    label="Git message effort"
                    description="Controls reasoning depth used for automatic commit and PR text."
                    control={
                      <select
                        style={controlStyle}
                        value={
                          state?.preferences.gitMessageModelEffort ?? "high"
                        }
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          void updatePreferences({
                            ...state.preferences,
                            gitMessageModelEffort: event.target.value,
                          });
                        }}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="xhigh">XHigh</option>
                      </select>
                    }
                  />
                </SettingsSection>

                <SettingsSection title="ABOUT">
                  <SettingRow
                    label={
                      <>
                        Version{" "}
                        <span
                          style={{
                            fontFamily: "monospace",
                            color: "var(--text-muted)",
                            marginLeft: "6px",
                            fontWeight: 400,
                          }}
                        >
                          {__APP_VERSION__}
                        </span>
                      </>
                    }
                    description="Current version of the application."
                    control={
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <button
                          disabled={checkingUpdate || installingUpdate}
                          onClick={() => {
                            setCheckingUpdate(true);
                            setUpdateStatus("");
                            setUpdateAvailableVersion(null);
                            setUpdateInstalled(false);
                            const channel =
                              state?.preferences.updateChannel ?? "stable";
                            void checkForAppUpdate(channel)
                              .then((result) => {
                                if (result.status === "up-to-date") {
                                  setUpdateStatus(
                                    `picode ${result.currentVersion} is up to date on ${channel}!`,
                                  );
                                  addToast({
                                    message: `picode ${result.currentVersion} is up to date.`,
                                    type: "success",
                                  });
                                } else if (result.status === "no-release") {
                                  setUpdateStatus(
                                    `No updates for picode ${result.currentVersion} on ${channel} yet!`,
                                  );
                                  addToast({
                                    message: `No updates available on ${channel} yet.`,
                                    type: "info",
                                  });
                                } else if (
                                  result.status === "update-available"
                                ) {
                                  setUpdateStatus(
                                    `picode ${result.latestVersion} is available on ${channel}.`,
                                  );
                                  setUpdateAvailableVersion(
                                    result.latestVersion ?? null,
                                  );
                                  addToast({
                                    message: `picode ${result.latestVersion} is available!`,
                                    type: "info",
                                  });
                                }
                              })
                              .catch((error) => {
                                const message =
                                  error instanceof Error
                                    ? error.message
                                    : String(error);
                                setUpdateStatus(message);
                                addToast({
                                  message: `Update check failed: ${message}`,
                                  type: "error",
                                });
                              })
                              .finally(() => setCheckingUpdate(false));
                          }}
                          style={btnStyle}
                          type="button"
                        >
                          {checkingUpdate
                            ? "Checking..."
                            : updateInstalled
                              ? "Check Again"
                              : "Check for Updates"}
                        </button>
                        {updateAvailableVersion && !updateInstalled && (
                          <button
                            disabled={installingUpdate}
                            onClick={() => {
                              setInstallingUpdate(true);
                              const channel =
                                state?.preferences.updateChannel ?? "stable";
                              void installAppUpdate(channel)
                                .then((result) => {
                                  setUpdateInstalled(true);
                                  setUpdateAvailableVersion(null);
                                  setUpdateStatus(
                                    `Installed picode ${result.latestVersion ?? updateAvailableVersion}! Restart to finish updating.`,
                                  );
                                })
                                .catch((error) => {
                                  const message =
                                    error instanceof Error
                                      ? error.message
                                      : String(error);
                                  setUpdateStatus(`Install failed: ${message}`);
                                })
                                .finally(() => setInstallingUpdate(false));
                            }}
                            style={{
                              ...btnStyle,
                              background: "var(--accent)",
                              borderColor: "var(--accent)",
                              color: "var(--text)",
                            }}
                            type="button"
                          >
                            {installingUpdate
                              ? "Installing..."
                              : `Install ${updateAvailableVersion}`}
                          </button>
                        )}
                        {updateInstalled && (
                          <button
                            onClick={() => restartApp()}
                            style={{
                              ...btnStyle,
                              background: "var(--success)",
                              borderColor: "var(--success)",
                              color: "var(--text)",
                            }}
                            type="button"
                          >
                            Restart
                          </button>
                        )}
                      </div>
                    }
                  />
                  <SettingRow
                    label="Update track"
                    description="Stable follows full releases. Nightly follows the prerelease tagged nightly."
                    control={
                      <select
                        style={controlStyle}
                        value={state?.preferences.updateChannel ?? "stable"}
                        onChange={(event) => {
                          if (!state) {
                            return;
                          }

                          const newChannel = event.target.value as
                            | "stable"
                            | "nightly";
                          void updatePreferences({
                            ...state.preferences,
                            updateChannel: newChannel,
                          });

                          const channelLabel =
                            newChannel === "nightly" ? "Nightly" : "Stable";
                          void checkForAppUpdate(newChannel)
                            .then((result) => {
                              if (result.status === "up-to-date") {
                                addToast({
                                  message: `Switched to ${channelLabel} — picode ${result.currentVersion} is up to date.`,
                                  type: "success",
                                });
                              } else if (result.status === "no-release") {
                                addToast({
                                  message: `Switched to ${channelLabel} — no updates available yet.`,
                                  type: "info",
                                });
                              } else if (result.status === "update-available") {
                                addToast({
                                  message: `Switched to ${channelLabel} — picode ${result.latestVersion} is available.`,
                                  type: "info",
                                });
                              }
                            })
                            .catch((error) => {
                              const message =
                                error instanceof Error
                                  ? error.message
                                  : String(error);
                              addToast({
                                message: `Switched to ${channelLabel} — check failed: ${message}`,
                                type: "error",
                              });
                            });
                        }}
                      >
                        <option value="stable">Stable</option>
                        <option value="nightly">Nightly</option>
                      </select>
                    }
                  />
                  <SettingRow
                    label="Diagnostics"
                    description={
                      <div style={{ marginTop: "4px" }}>
                        Local trace file.
                        <div
                          style={{
                            fontFamily: "monospace",
                            color: "var(--text-muted)",
                            marginTop: "4px",
                          }}
                        >
                          {appPaths?.logsDir ?? "Resolving path..."}
                        </div>
                      </div>
                    }
                    control={
                      <button
                        style={btnStyle}
                        disabled={!appPaths}
                        onClick={() => {
                          if (appPaths) {
                            void openPath(appPaths.logsDir);
                          }
                        }}
                      >
                        Open logs folder
                      </button>
                    }
                  />
                </SettingsSection>
              </>
            )}

            {activeTab === "connections" && (
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: "24px",
                }}
              >
                <SettingsSection title="PI RUNTIME">
                  <SettingRow
                    label="Status"
                    description="Checks whether a system-installed `pi` binary is available and responding over RPC."
                    control={
                      <div
                        style={{
                          border: "1px solid var(--line)",
                          borderRadius: "999px",
                          padding: "6px 10px",
                          fontSize: "0.78rem",
                          color:
                            runtimeInstall?.status === "ready"
                              ? "var(--text-muted)"
                              : runtimeInstall?.status === "broken"
                                ? "var(--danger)"
                                : "var(--warning)",
                        }}
                      >
                        {runtimeInstall?.status === "ready"
                          ? "Ready"
                          : runtimeInstall?.status === "broken"
                            ? "Broken"
                            : "Missing"}
                      </div>
                    }
                  />
                  <SettingRow
                    label="Detected binary"
                    description={
                      runtimeInstall?.binaryPath ??
                      "No Pi binary has been detected yet."
                    }
                    control={
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        {runtimeInstall?.version ?? "No version"}
                      </div>
                    }
                  />
                  <SettingRow
                    label="Manual override"
                    description="Provide a full path to a specific `pi` binary. Leaving this empty falls back to PATH and standard install locations."
                    control={
                      <input
                        style={{ ...controlStyle, minWidth: "280px" }}
                        value={piBinaryInput}
                        placeholder="/full/path/to/pi"
                        onChange={(event) =>
                          setPiBinaryInput(event.target.value)
                        }
                        onBlur={() => {
                          void commitPiBinaryOverride(piBinaryInput);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitPiBinaryOverride(piBinaryInput);
                          }
                        }}
                      />
                    }
                  />
                  <SettingRow
                    label="Actions"
                    description="Refresh detection, clear the override, or open the official Pi documentation."
                    control={
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <button
                          style={btnStyle}
                          onClick={() => {
                            void refreshRuntimeHealth();
                          }}
                        >
                          Refresh
                        </button>
                        {state?.preferences.piBinaryPath && (
                          <button
                            style={btnStyle}
                            onClick={() => {
                              setPiBinaryInput("");
                              if (state) {
                                void updatePreferences({
                                  ...state.preferences,
                                  piBinaryPath: undefined,
                                });
                              }
                            }}
                          >
                            Clear override
                          </button>
                        )}
                        <button
                          style={btnStyle}
                          onClick={() => {
                            void openPath(
                              runtimeInstall?.installUrl ??
                                "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md",
                            );
                          }}
                        >
                          Open Pi docs
                        </button>
                      </div>
                    }
                  />
                </SettingsSection>

                {(runtimeInstall?.status === "missing" ||
                  runtimeInstall?.status === "broken") && (
                  <SettingsSection title="INSTALLATION HELP">
                    <div
                      style={{
                        background: "var(--surface)",
                        border: "1px solid var(--line)",
                        borderRadius: "12px",
                        padding: "20px",
                        color: "var(--text-muted)",
                        fontSize: "0.88rem",
                        lineHeight: 1.6,
                      }}
                    >
                      <div
                        style={{
                          marginBottom: "12px",
                          color: "var(--text)",
                          fontWeight: 600,
                        }}
                      >
                        Install Pi globally, then finish setup in the terminal.
                      </div>
                      <div
                        style={{
                          fontFamily: "monospace",
                          color: "var(--text)",
                          marginBottom: "10px",
                        }}
                      >
                        {runtimeInstall.installCommand}
                      </div>
                      <div
                        style={{
                          fontFamily: "monospace",
                          color: "var(--text-muted)",
                        }}
                      >
                        pi
                      </div>
                      <div
                        style={{
                          fontFamily: "monospace",
                          color: "var(--text-muted)",
                          marginBottom: "12px",
                        }}
                      >
                        /login
                      </div>
                      <button
                        style={btnStyle}
                        onClick={() => {
                          void openPath(runtimeInstall.installUrl);
                        }}
                      >
                        Open README and provider docs
                      </button>
                    </div>
                  </SettingsSection>
                )}

                <SettingsSection title="DIAGNOSTICS">
                  <div
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      borderRadius: "12px",
                      padding: "20px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                      color: "var(--text-muted)",
                      fontSize: "0.84rem",
                    }}
                  >
                    <div>
                      Resolved binary path:{" "}
                      <span
                        style={{
                          color: "var(--text)",
                          fontFamily: "monospace",
                        }}
                      >
                        {runtimeInstall?.binaryPath ?? "none"}
                      </span>
                    </div>
                    <div>
                      Last runtime error:{" "}
                      <span style={{ color: "var(--text)" }}>
                        {runtimeInstall?.error ?? runtimeGlobalError ?? "none"}
                      </span>
                    </div>
                    <div>
                      Active workspace catalog:{" "}
                      <span style={{ color: "var(--text)" }}>
                        {!activeWorkspace
                          ? "No active workspace"
                          : workspaceCatalogErrors[activeWorkspace.id]
                            ? `Failed: ${workspaceCatalogErrors[activeWorkspace.id]}`
                            : workspaceCatalogs[activeWorkspace.id]
                              ? "Succeeded"
                              : "Not fetched yet"}
                      </span>
                    </div>
                  </div>
                </SettingsSection>
              </div>
            )}

            {activeTab === "theme" && (
              <ThemePicker
                currentTheme={state?.preferences.theme ?? "dark"}
                customColors={state?.preferences.customThemeColors}
                updatePreferences={updatePreferences}
                state={state}
              />
            )}

            {activeTab === "shortcuts" && (
              <SettingsSection title="SHORTCUTS">
                <SettingRow
                  label="Keyboard shortcuts"
                  description="Click a shortcut, press the replacement keys, or clear it."
                  control={
                    <ShortcutActionButton onClick={restoreAllShortcuts}>
                      Restore all defaults
                    </ShortcutActionButton>
                  }
                />
                {shortcutDefinitions.map((shortcut) => {
                  const value = getShortcutBinding(
                    state?.preferences.shortcuts,
                    shortcut.id,
                  );

                  return (
                    <SettingRow
                      key={shortcut.id}
                      label={shortcut.label}
                      description={shortcut.description}
                      control={
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <ShortcutRecorder
                            value={value}
                            onChange={(next) => setShortcut(shortcut.id, next)}
                          />
                          <ShortcutActionButton
                            onClick={() => setShortcut(shortcut.id, null)}
                          >
                            Clear
                          </ShortcutActionButton>
                          <ShortcutActionButton
                            onClick={() => setShortcut(shortcut.id, undefined)}
                          >
                            Restore default
                          </ShortcutActionButton>
                        </div>
                      }
                    />
                  );
                })}
              </SettingsSection>
            )}

            {activeTab === "archive" && (
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
                <div
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: 600,
                    marginBottom: "8px",
                  }}
                >
                  Archived Threads
                </div>
                {archivedSessions.length === 0 ? (
                  <div
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "0.9rem",
                      textAlign: "center",
                      padding: "40px",
                      background: "var(--surface)",
                      border: "1px dashed var(--line)",
                      borderRadius: "12px",
                    }}
                  >
                    No archived threads found.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "1px",
                      background: "var(--surface-elevated)",
                      border: "1px solid var(--line)",
                      borderRadius: "12px",
                      overflow: "hidden",
                    }}
                  >
                    {archivedSessions.map(
                      ({ workspaceId, workspaceName, session }) => (
                        <div
                          key={session.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "12px 20px",
                            background: "var(--bg)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "2px",
                            }}
                          >
                            <div
                              style={{
                                fontSize: "0.9rem",
                                fontWeight: 500,
                                color: "var(--text)",
                              }}
                            >
                              {session.title}
                            </div>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "var(--text-dim)",
                              }}
                            >
                              {workspaceName} • Archived on{" "}
                              {new Date(
                                session.archivedAt,
                              ).toLocaleDateString()}
                            </div>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                            }}
                          >
                            <button
                              onClick={() =>
                                restoreSession(workspaceId, session.id)
                              }
                              style={{
                                ...btnStyle,
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                borderColor: "var(--line)",
                                padding: "6px 10px",
                              }}
                            >
                              <RefreshCw size={14} />
                              Restore
                            </button>
                            <button
                              onClick={async () => {
                                const { ask } =
                                  await import("@tauri-apps/plugin-dialog");
                                const confirmed = await ask(
                                  `Delete "${session.title}" permanently?`,
                                  {
                                    title: "Delete Thread",
                                    kind: "warning",
                                  },
                                );
                                if (confirmed) {
                                  deleteSession(workspaceId, session.id);
                                }
                              }}
                              style={{
                                ...btnStyle,
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                borderColor: "var(--line)",
                                color: "var(--danger)",
                                padding: "6px 10px",
                              }}
                            >
                              <Trash2 size={14} />
                              Delete
                            </button>
                          </div>
                        </div>
                      ),
                    )}
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
