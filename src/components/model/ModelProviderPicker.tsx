import type { WorkspaceRecord } from "../../domains/types";
import { useAppStore } from "../../state/useAppStore";
import { resolveProviderSwitchModel } from "../chat/chatRuntime";

interface ModelProviderPickerProps {
  workspace: WorkspaceRecord | null;
}

export function ModelProviderPicker({ workspace }: ModelProviderPickerProps) {
  const state = useAppStore((store) => store.state);
  const providerModelMemory = useAppStore(
    (store) => store.state?.preferences.providerModelMemory ?? {},
  );
  const preferences = useAppStore((store) => store.state?.preferences);
  const workspaceCatalogs = useAppStore((store) => store.workspaceCatalogs);
  const updateWorkspaceSettings = useAppStore(
    (store) => store.updateWorkspaceSettings,
  );
  const updatePreferences = useAppStore((store) => store.updatePreferences);
  const refreshWorkspaceRuntimeCatalog = useAppStore(
    (store) => store.refreshWorkspaceRuntimeCatalog,
  );

  if (!workspace || !state) {
    return null;
  }

  const providers = workspaceCatalogs[workspace.id] ?? state.providers;
  const provider = providers.find((item) => item.id === workspace.providerId);

  const selectStyle: React.CSSProperties = {
    background: "var(--surface-elevated)",
    border: "1px solid var(--line)",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "0.8rem",
    color: "inherit",
    outline: "none",
    cursor: "pointer",
  };

  const labelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "0.75rem",
    color: "var(--text-dim)",
    fontWeight: 500,
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
      <label style={labelStyle}>
        <span>Provider</span>
        <select
          style={selectStyle}
          value={workspace.providerId}
          onChange={async (event) => {
            const providerId = event.target.value;
            let nextProviders = providers;
            const currentProviderMemory = {
              ...providerModelMemory,
              [workspace.providerId]: {
                providerId: workspace.providerId,
                modelId: workspace.modelId,
                effort: workspace.effort,
                fastMode: workspace.fastMode,
              },
            };

            if (providerId === "openai-codex") {
              const refreshed = await refreshWorkspaceRuntimeCatalog(
                workspace.id,
              );
              nextProviders = refreshed?.providers ?? nextProviders;
            }

            const nextProvider = nextProviders.find(
              (item) => item.id === providerId,
            );

            void updateWorkspaceSettings({
              workspaceId: workspace.id,
              approvalMode: workspace.approvalMode,
              providerId,
              modelId: resolveProviderSwitchModel({
                provider: nextProvider,
                currentProviderId: workspace.providerId,
                currentModelId: workspace.modelId,
                providerModelMemory: currentProviderMemory,
              }),
              policy: workspace.policy,
            });
          }}
        >
          {providers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        <span>Model</span>
        <select
          style={selectStyle}
          value={workspace.modelId}
          onChange={(event) => {
            const newModelId = event.target.value;

            void updateWorkspaceSettings({
              workspaceId: workspace.id,
              approvalMode: workspace.approvalMode,
              providerId: workspace.providerId,
              modelId: newModelId,
              policy: workspace.policy,
            });

            if (preferences) {
              const currentMemory = preferences.providerModelMemory ?? {};
              void updatePreferences({
                ...preferences,
                providerModelMemory: {
                  ...currentMemory,
                  [workspace.providerId]: {
                    providerId: workspace.providerId,
                    modelId: newModelId,
                    effort: workspace.effort,
                    fastMode: workspace.fastMode,
                  },
                },
              });
            }
          }}
        >
          {provider?.models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
