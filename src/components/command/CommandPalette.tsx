import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../state/useAppStore";

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const open = useAppStore((state) => state.commandPaletteOpen);
  const setOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const state = useAppStore((store) => store.state);
  const createSession = useAppStore((store) => store.createSession);
  const selectWorkspaceSession = useAppStore(
    (store) => store.selectWorkspaceSession,
  );
  const deferredQuery = useDeferredValue(query.toLowerCase());
  const navigate = useNavigate();

  const commands = useMemo(() => {
    if (!state) {
      return [];
    }

    const workspaceCommands = state.workspaces.flatMap((workspace) => [
      {
        id: `workspace-${workspace.id}`,
        label: `Switch workspace: ${workspace.name}`,
        run: () =>
          void selectWorkspaceSession(
            workspace.id,
            workspace.sessions[0]?.id ?? null,
          ),
      },
      ...workspace.sessions.map((session) => ({
        id: `session-${session.id}`,
        label: `Open chat: ${session.title}`,
        run: () => void selectWorkspaceSession(workspace.id, session.id),
      })),
    ]);

    const utilityCommands = [
      {
        id: "new-chat",
        label: "New chat in active workspace",
        run: () =>
          state.activeWorkspaceId &&
          void createSession(state.activeWorkspaceId),
      },
      {
        id: "settings",
        label: "Open settings",
        run: () => navigate("/settings"),
      },
    ];

    return [...utilityCommands, ...workspaceCommands].filter((item) =>
      item.label.toLowerCase().includes(deferredQuery),
    );
  }, [createSession, deferredQuery, navigate, selectWorkspaceSession, state]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="palette-backdrop"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="palette"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jump to workspace, chat, or settings"
        />
        <div className="palette__results">
          {commands.map((command) => (
            <button
              key={command.id}
              className="palette__item"
              type="button"
              onClick={() => {
                command.run();
                setOpen(false);
                setQuery("");
              }}
            >
              {command.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
