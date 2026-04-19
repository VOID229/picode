import { startTransition } from "react";
import { create } from "zustand";
import type {
  ChatSession,
  GitSnapshot,
  PersistedAppState,
  PiInstallStatus,
  PiRuntimeEvent,
  TimelineItem,
  WorkspaceRecord,
} from "../domains/types";
import {
  abortPrompt as abortPromptCommand,
  bootstrapState,
  bootstrapRuntime,
  createSession as createSessionCommand,
  createWorkspace as createWorkspaceCommand,
  refreshGit as refreshGitCommand,
  refreshWorkspaceRuntimeCatalog as refreshWorkspaceRuntimeCatalogCommand,
  resolveApproval as resolveApprovalCommand,
  runtimeHealthcheck as runtimeHealthcheckCommand,
  selectWorkspaceSession as selectWorkspaceSessionCommand,
  sendPrompt as sendPromptCommand,
  updatePreferences as updatePreferencesCommand,
  updateWorkspaceSettings as updateWorkspaceSettingsCommand,
  renameWorkspace as renameWorkspaceCommand,
  removeWorkspace as removeWorkspaceCommand,
  renameSession as renameSessionCommand,
  archiveSession as archiveSessionCommand,
  restoreSession as restoreSessionCommand,
  deleteSession as deleteSessionCommand,
} from "../lib/tauri";

let initializePromise: Promise<void> | null = null;
let hasInitialized = false;

export interface CustomAction {
  id: string;
  name: string;
  icon: string;
  command: string;
  keybinding?: string;
}

interface AppStoreState {
  isBootstrapping: boolean;
  connectionReady: boolean;
  commandPaletteOpen: boolean;
  state: PersistedAppState | null;
  git: Record<string, GitSnapshot>;
  customActions: Record<string, CustomAction[]>; // workspaceId -> CustomAction[]
  currentMode: "plan" | "build";
  runtimeInstall?: PiInstallStatus;
  runtimeGlobalStatus?: string;
  runtimeGlobalError?: string;
  workspaceCatalogs: Record<string, PersistedAppState["providers"]>;
  workspaceCatalogErrors: Record<string, string | undefined>;
  initialize: () => Promise<void>;
  setConnectionReady: (ready: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setCurrentMode: (mode: "plan" | "build") => void;
  addCustomAction: (
    workspaceId: string,
    action: Omit<CustomAction, "id">,
  ) => void;
  updateCustomAction: (
    workspaceId: string,
    actionId: string,
    action: Omit<CustomAction, "id">,
  ) => void;
  removeCustomAction: (workspaceId: string, actionId: string) => void;
  selectWorkspaceSession: (
    workspaceId: string,
    sessionId: string | null,
  ) => Promise<void>;
  createWorkspace: (path: string, name?: string) => Promise<void>;
  createSession: (workspaceId: string) => Promise<void>;
  updatePreferences: (
    preferences: PersistedAppState["preferences"],
  ) => Promise<void>;
  updateWorkspaceSettings: (
    payload: Parameters<typeof updateWorkspaceSettingsCommand>[0],
  ) => Promise<void>;
  refreshGit: (workspaceId: string) => Promise<void>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  renameSession: (
    workspace_id: string,
    session_id: string,
    title: string,
  ) => Promise<void>;
  archiveSession: (workspace_id: string, session_id: string) => Promise<void>;
  restoreSession: (workspace_id: string, session_id: string) => Promise<void>;
  deleteSession: (workspace_id: string, session_id: string) => Promise<void>;
  sendPrompt: (
    workspaceId: string,
    sessionId: string,
    prompt: string,
  ) => Promise<void>;
  abortPrompt: (workspaceId: string, sessionId: string) => Promise<void>;
  resolveApproval: (
    workspaceId: string,
    sessionId: string,
    approvalId: string,
    decision: "approved" | "rejected",
  ) => Promise<void>;
  refreshRuntimeHealth: () => Promise<void>;
  refreshWorkspaceRuntimeCatalog: (workspaceId: string) => Promise<void>;
  applyRuntimeEvent: (event: PiRuntimeEvent) => void;
}

function findSession(
  state: PersistedAppState,
  workspaceId: string,
  sessionId: string,
) {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  const session = workspace?.sessions.find((item) => item.id === sessionId);
  return { workspace, session };
}

function pushOrReplaceTimelineItem(
  session: WorkspaceRecord["sessions"][number],
  item: TimelineItem,
) {
  const existingIndex = session.timeline.findIndex(
    (entry) => entry.id === item.id,
  );
  if (existingIndex >= 0) {
    session.timeline[existingIndex] = item;
  } else {
    session.timeline.push(item);
  }
  session.updatedAt = item.createdAt;
}

function applyRuntimeMetadata(
  session: WorkspaceRecord["sessions"][number],
  metadata?: ChatSession["runtime"],
) {
  if (!metadata) {
    return;
  }

  session.runtime = {
    ...session.runtime,
    ...metadata,
  };
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  isBootstrapping: true,
  connectionReady: false,
  commandPaletteOpen: false,
  state: null,
  git: {},
  customActions: {},
  currentMode: "build",
  workspaceCatalogs: {},
  workspaceCatalogErrors: {},
  async initialize() {
    if (hasInitialized && get().state) {
      set({ isBootstrapping: false });
      return;
    }

    if (initializePromise) {
      return initializePromise;
    }

    set({ isBootstrapping: true });

    initializePromise = (async () => {
      const payload = await bootstrapState();
      let runtimePayload:
        | Awaited<ReturnType<typeof bootstrapRuntime>>
        | undefined;
      let runtimeGlobalError: string | undefined;

      try {
        runtimePayload = await bootstrapRuntime();
      } catch (error) {
        runtimeGlobalError =
          error instanceof Error ? error.message : String(error);
      }

      hasInitialized = true;

      set({
        isBootstrapping: false,
        state: payload.state,
        git: payload.git,
        connectionReady: true,
        runtimeInstall: runtimePayload?.install,
        runtimeGlobalError,
      });

      const activeWorkspaceId = payload.state.activeWorkspaceId;
      if (runtimePayload?.install.status === "ready" && activeWorkspaceId) {
        await get().refreshWorkspaceRuntimeCatalog(activeWorkspaceId);
      }
    })()
      .catch((error) => {
        set({
          isBootstrapping: false,
          runtimeGlobalError:
            error instanceof Error ? error.message : String(error),
        });
        throw error;
      })
      .finally(() => {
        initializePromise = null;
      });

    return initializePromise;
  },
  setConnectionReady(connectionReady) {
    set({ connectionReady });
  },
  setCommandPaletteOpen(commandPaletteOpen) {
    set({ commandPaletteOpen });
  },
  setCurrentMode(currentMode) {
    set({ currentMode });
  },
  addCustomAction(workspaceId, action) {
    set((store) => {
      const actions = store.customActions[workspaceId] ?? [];
      return {
        customActions: {
          ...store.customActions,
          [workspaceId]: [...actions, { ...action, id: crypto.randomUUID() }],
        },
      };
    });
  },
  updateCustomAction(workspaceId, actionId, updatedAction) {
    set((store) => {
      const actions = store.customActions[workspaceId] ?? [];
      return {
        customActions: {
          ...store.customActions,
          [workspaceId]: actions.map((a) =>
            a.id === actionId ? { ...updatedAction, id: actionId } : a,
          ),
        },
      };
    });
  },
  removeCustomAction(workspaceId, actionId) {
    set((store) => {
      const actions = store.customActions[workspaceId] ?? [];
      return {
        customActions: {
          ...store.customActions,
          [workspaceId]: actions.filter((a) => a.id !== actionId),
        },
      };
    });
  },
  async selectWorkspaceSession(workspaceId, sessionId) {
    const state = await selectWorkspaceSessionCommand({
      workspaceId,
      sessionId,
    });
    set({ state });
    if (get().runtimeInstall?.status === "ready") {
      await get().refreshWorkspaceRuntimeCatalog(workspaceId);
    }
  },
  async createWorkspace(path, name) {
    const workspace = await createWorkspaceCommand({ path, name });
    startTransition(() => {
      set((store) => ({
        state: store.state
          ? {
              ...store.state,
              workspaces: [workspace, ...store.state.workspaces],
              activeWorkspaceId: workspace.id,
              activeSessionId: workspace.sessions[0]?.id ?? null,
            }
          : store.state,
      }));
    });
    if (get().runtimeInstall?.status === "ready") {
      await get().refreshWorkspaceRuntimeCatalog(workspace.id);
    }
  },
  async createSession(workspaceId) {
    const store = get();
    const workspace = store.state?.workspaces.find((w) => w.id === workspaceId);
    if (workspace) {
      const emptySession = workspace.sessions.find(
        (s) => !s.timeline.some((t) => t.kind === "user-message"),
      );
      if (emptySession) {
        await store.selectWorkspaceSession(workspaceId, emptySession.id);
        return;
      }
    }

    const state = await createSessionCommand({ workspaceId });
    set({ state });
  },
  async updatePreferences(preferences) {
    const state = await updatePreferencesCommand(preferences);
    set({ state });
    await get().refreshRuntimeHealth();
  },
  async updateWorkspaceSettings(payload) {
    const state = await updateWorkspaceSettingsCommand(payload);
    set({ state });
  },
  async refreshGit(workspaceId) {
    const snapshot = await refreshGitCommand({ workspaceId });
    set((store) => ({
      git: { ...store.git, [workspaceId]: snapshot },
    }));
  },
  async renameWorkspace(workspaceId, name) {
    const state = await renameWorkspaceCommand(workspaceId, name);
    set({ state });
  },
  async removeWorkspace(workspaceId) {
    const state = await removeWorkspaceCommand(workspaceId);
    set((store) => {
      const nextCatalogs = { ...store.workspaceCatalogs };
      const nextErrors = { ...store.workspaceCatalogErrors };
      delete nextCatalogs[workspaceId];
      delete nextErrors[workspaceId];
      return {
        state,
        workspaceCatalogs: nextCatalogs,
        workspaceCatalogErrors: nextErrors,
      };
    });
  },
  async renameSession(workspaceId, sessionId, title) {
    const state = await renameSessionCommand(workspaceId, sessionId, title);
    set({ state });
  },
  async archiveSession(workspaceId, sessionId) {
    const state = await archiveSessionCommand(workspaceId, sessionId);
    set({ state });
  },
  async restoreSession(workspaceId, sessionId) {
    const state = await restoreSessionCommand(workspaceId, sessionId);
    set({ state });
  },
  async deleteSession(workspaceId, sessionId) {
    const state = await deleteSessionCommand(workspaceId, sessionId);
    set({ state });
  },
  async sendPrompt(workspaceId, sessionId, prompt) {
    const state = await sendPromptCommand({ workspaceId, sessionId, prompt });
    set({ state });
  },
  async abortPrompt(workspaceId, sessionId) {
    const state = await abortPromptCommand({ workspaceId, sessionId });
    set({ state });
  },
  async resolveApproval(workspaceId, sessionId, approvalId, decision) {
    const state = await resolveApprovalCommand({
      workspaceId,
      sessionId,
      approvalId,
      decision,
    });
    set({ state });
  },
  async refreshRuntimeHealth() {
    const payload = await runtimeHealthcheckCommand();
    set((store) => ({
      runtimeInstall: payload.install,
      runtimeGlobalError: undefined,
      workspaceCatalogs:
        payload.install.status === "ready" ? store.workspaceCatalogs : {},
      workspaceCatalogErrors:
        payload.install.status === "ready" ? store.workspaceCatalogErrors : {},
    }));

    if (payload.install.status === "ready") {
      const activeWorkspaceId = get().state?.activeWorkspaceId;
      if (activeWorkspaceId) {
        await get().refreshWorkspaceRuntimeCatalog(activeWorkspaceId);
      }
    }
  },
  async refreshWorkspaceRuntimeCatalog(workspaceId) {
    if (get().runtimeInstall?.status !== "ready") {
      return;
    }

    try {
      const payload = await refreshWorkspaceRuntimeCatalogCommand({
        workspaceId,
      });
      set((store) => {
        if (!store.state) {
          return {
            workspaceCatalogs: {
              ...store.workspaceCatalogs,
              [workspaceId]: payload.providers,
            },
            workspaceCatalogErrors: {
              ...store.workspaceCatalogErrors,
              [workspaceId]: undefined,
            },
          };
        }

        const nextState = structuredClone(store.state);
        const workspace = nextState.workspaces.find(
          (item) => item.id === workspaceId,
        );
        if (workspace) {
          workspace.providerId = payload.selectedProviderId;
          workspace.modelId = payload.selectedModelId;
        }

        return {
          state: nextState,
          workspaceCatalogs: {
            ...store.workspaceCatalogs,
            [workspaceId]: payload.providers,
          },
          workspaceCatalogErrors: {
            ...store.workspaceCatalogErrors,
            [workspaceId]: undefined,
          },
        };
      });
    } catch (error) {
      set((store) => ({
        workspaceCatalogErrors: {
          ...store.workspaceCatalogErrors,
          [workspaceId]: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  },
  applyRuntimeEvent(event) {
    set((store) => {
      if (!store.state) {
        return store;
      }

      const state = structuredClone(store.state);

      switch (event.type) {
        case "token": {
          const { session } = findSession(
            state,
            event.workspaceId,
            event.sessionId,
          );
          if (!session) {
            return store;
          }
          const existing = [...session.timeline]
            .reverse()
            .find(
              (item) => item.kind === "assistant-message" && item.streaming,
            );

          if (existing && existing.kind === "assistant-message") {
            existing.content += event.delta;
            session.updatedAt = new Date().toISOString();
          } else {
            session.timeline.push({
              id: crypto.randomUUID(),
              kind: "assistant-message",
              content: event.delta,
              createdAt: new Date().toISOString(),
              streaming: true,
            });
          }

          session.status = "streaming";
          applyRuntimeMetadata(session, event.metadata);
          break;
        }
        case "tool-start": {
          const { session } = findSession(
            state,
            event.workspaceId,
            event.sessionId,
          );
          if (!session) {
            return store;
          }
          pushOrReplaceTimelineItem(session, {
            id: event.activity.id,
            kind: "tool-activity",
            activity: event.activity,
            createdAt: event.activity.startedAt,
          });
          break;
        }
        case "tool-output": {
          const { session } = findSession(
            state,
            event.workspaceId,
            event.sessionId,
          );
          if (!session) {
            return store;
          }
          const item = session.timeline.find(
            (entry) =>
              entry.kind === "tool-activity" &&
              entry.activity.id === event.activityId,
          );

          if (item && item.kind === "tool-activity") {
            item.activity.output = event.output;
            item.activity.status = event.status;
            session.updatedAt = new Date().toISOString();
          }
          break;
        }
        case "approval-requested": {
          const { session } = findSession(
            state,
            event.workspaceId,
            event.sessionId,
          );
          if (!session) {
            return store;
          }
          pushOrReplaceTimelineItem(session, {
            id: event.approval.id,
            kind: "approval-request",
            approval: event.approval,
            createdAt: event.approval.requestedAt,
          });
          session.status = "awaiting-approval";
          break;
        }
        case "approval-resolved": {
          const { session } = findSession(
            state,
            event.workspaceId,
            event.sessionId,
          );
          if (!session) {
            return store;
          }
          const existing = session.timeline.find(
            (entry) =>
              entry.kind === "approval-request" &&
              entry.approval.id === event.approvalId,
          );

          if (existing && existing.kind === "approval-request") {
            existing.approval.status = event.decision;
          }

          session.timeline.push({
            id: crypto.randomUUID(),
            kind: "approval-resolution",
            approvalId: event.approvalId,
            decision: event.decision,
            summary: event.summary,
            createdAt: new Date().toISOString(),
          });
          session.status = "idle";
          break;
        }
        case "status": {
          if (!event.workspaceId || !event.sessionId) {
            return {
              ...store,
              runtimeGlobalStatus: event.detail
                ? `${event.label}: ${event.detail}`
                : event.label,
            };
          }
          const { session } = findSession(
            state,
            event.workspaceId,
            event.sessionId,
          );
          if (!session) {
            return store;
          }
          session.timeline.push({
            id: crypto.randomUUID(),
            kind: "system-notice",
            title: event.label,
            detail: event.detail ?? "",
            createdAt: new Date().toISOString(),
          });
          break;
        }
        case "error": {
          if (!event.workspaceId || !event.sessionId) {
            return {
              ...store,
              runtimeGlobalError: event.message,
            };
          }
          const { session } = findSession(
            state,
            event.workspaceId,
            event.sessionId,
          );
          if (!session) {
            return store;
          }
          session.timeline.push({
            id: crypto.randomUUID(),
            kind: "error",
            title: "Runtime error",
            detail: event.message,
            createdAt: new Date().toISOString(),
          });
          session.status = "error";
          applyRuntimeMetadata(session, event.metadata);
          break;
        }
        case "done": {
          const { session } = findSession(
            state,
            event.workspaceId,
            event.sessionId,
          );
          if (!session) {
            return store;
          }
          const existing = [...session.timeline]
            .reverse()
            .find(
              (item) => item.kind === "assistant-message" && item.streaming,
            );

          if (existing && existing.kind === "assistant-message") {
            existing.content = event.content;
            existing.streaming = false;
          } else {
            session.timeline.push({
              id: crypto.randomUUID(),
              kind: "assistant-message",
              content: event.content,
              createdAt: new Date().toISOString(),
            });
          }
          session.status = "idle";
          applyRuntimeMetadata(session, event.metadata);
          break;
        }
      }

      return { ...store, state };
    });
  },
}));
