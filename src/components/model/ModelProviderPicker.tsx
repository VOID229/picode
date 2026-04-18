import type { WorkspaceRecord } from "../../domains/types";
import { useAppStore } from "../../state/useAppStore";

interface ModelProviderPickerProps {
  workspace: WorkspaceRecord | null;
}

export function ModelProviderPicker({ workspace }: ModelProviderPickerProps) {
  const state = useAppStore((store) => store.state);
  const updateWorkspaceSettings = useAppStore(
    (store) => store.updateWorkspaceSettings,
  );

  if (!workspace || !state) {
    return null;
  }

  const provider = state.providers.find(
    (item) => item.id === workspace.providerId,
  );

  const selectStyle: React.CSSProperties = {
    background: 'var(--surface-elevated)',
    border: '1px solid var(--line)',
    borderRadius: '6px',
    padding: '4px 8px',
    fontSize: '0.8rem',
    color: 'inherit',
    outline: 'none',
    cursor: 'pointer'
  };

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.75rem',
    color: 'var(--text-dim)',
    fontWeight: 500
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
      <label style={labelStyle}>
        <span>Provider</span>
        <select
          style={selectStyle}
          value={workspace.providerId}
          onChange={(event) => {
            const nextProvider = state.providers.find(
              (item) => item.id === event.target.value,
            );

            void updateWorkspaceSettings({
              workspaceId: workspace.id,
              approvalMode: workspace.approvalMode,
              providerId: event.target.value,
              modelId: nextProvider?.models[0]?.id ?? workspace.modelId,
              policy: workspace.policy,
            });
          }}
        >
          {state.providers.map((item) => (
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
          onChange={(event) =>
            void updateWorkspaceSettings({
              workspaceId: workspace.id,
              approvalMode: workspace.approvalMode,
              providerId: workspace.providerId,
              modelId: event.target.value,
              policy: workspace.policy,
            })
          }
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
