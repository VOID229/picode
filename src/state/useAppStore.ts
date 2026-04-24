import { startTransition } from "react";
import { create } from "zustand";
import type {
  ChatSession,
  ComposerImageDraft,
  GitSnapshot,
  MessageImageAttachment,
  PersistedAppState,
  PiInstallStatus,
  PromptMode,
  PiRuntimeEvent,
  TerminalEvent,
  TerminalSessionState,
  TimelineItem,
  WorkspaceCatalogStatus,
  WorkspaceTerminalState,
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
  closeTerminalSession as closeTerminalSessionCommand,
  restoreSession as restoreSessionCommand,
  deleteSession as deleteSessionCommand,
  moveWorkspace as moveWorkspaceCommand,
  moveSession as moveSessionCommand,
  undoUserTurn as undoUserTurnCommand,
  redoUserTurn as redoUserTurnCommand,
  ensureTerminalSession as ensureTerminalSessionCommand,
  writeTerminalInput as writeTerminalInputCommand,
  resizeTerminal as resizeTerminalCommand,
  runTerminalCommand as runTerminalCommandCommand,
} from "../lib/tauri";
import { getUndoComposerMessage } from "./sessionUndo";

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
  terminalPaneOpen: boolean;
  state: PersistedAppState | null;
  git: Record<string, GitSnapshot>;
  terminals: Record<string, WorkspaceTerminalState>;
  customActions: Record<string, CustomAction[]>; // workspaceId -> CustomAction[]
  currentMode: "plan" | "build";
  runtimeInstall?: PiInstallStatus;
  runtimeGlobalStatus?: string;
  runtimeGlobalError?: string;
  workspaceCatalogs: Record<string, PersistedAppState["providers"]>;
  workspaceCatalogStatus: Record<string, WorkspaceCatalogStatus>;
  workspaceCatalogLoaded: Record<string, boolean>;
  workspaceCatalogErrors: Record<string, string | undefined>;
  composerDrafts: Record<string, string>;
  composerImageDrafts: Record<string, ComposerImageDraft[]>;
  initialize: () => Promise<void>;
  setConnectionReady: (ready: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setTerminalPaneOpen: (open: boolean) => void;
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
  createSession: (
    workspaceId: string,
    options?: { forceNew?: boolean },
  ) => Promise<string | null>;
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
  moveWorkspace: (
    workspaceId: string,
    beforeWorkspaceId?: string | null,
  ) => Promise<void>;
  moveSession: (
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string | null,
  ) => Promise<void>;
  undoUserTurn: (
    workspaceId: string,
    sessionId: string,
    userMessageId: string,
  ) => Promise<void>;
  redoUserTurn: (
    workspaceId: string,
    sessionId: string,
    userMessageId: string,
  ) => Promise<void>;
  sendPrompt: (
    workspaceId: string,
    sessionId: string,
    prompt: string,
    mode: PromptMode,
    images?: MessageImageAttachment[],
  ) => Promise<void>;
  abortPrompt: (workspaceId: string, sessionId: string) => Promise<void>;
  resolveApproval: (
    workspaceId: string,
    sessionId: string,
    approvalId: string,
    decision: "approved" | "rejected",
  ) => Promise<void>;
  ensureTerminalSession: (
    workspaceId: string,
    terminalTabId: string,
  ) => Promise<void>;
  closeTerminalTab: (
    workspaceId: string,
    terminalTabId: string,
  ) => Promise<void>;
  createTerminalTab: (workspaceId: string) => Promise<string>;
  renameTerminalTab: (
    workspaceId: string,
    terminalTabId: string,
    title: string,
  ) => void;
  setActiveTerminalTab: (workspaceId: string, terminalTabId: string) => void;
  clearTerminalBuffer: (workspaceId: string, terminalTabId: string) => void;
  restartTerminalTab: (
    workspaceId: string,
    terminalTabId: string,
  ) => Promise<void>;
  writeTerminalInput: (
    workspaceId: string,
    terminalTabId: string,
    data: string,
  ) => Promise<void>;
  resizeTerminal: (
    workspaceId: string,
    terminalTabId: string,
    cols: number,
    rows: number,
  ) => Promise<void>;
  runTerminalCommand: (
    workspaceId: string,
    command: string,
    options?: {
      refreshGit?: boolean;
      openPane?: boolean;
      terminalTabId?: string;
    },
  ) => Promise<void>;
  refreshRuntimeHealth: () => Promise<void>;
  refreshWorkspaceRuntimeCatalog: (workspaceId: string) => Promise<void>;
  setComposerDraft: (sessionId: string, draft: string) => void;
  setComposerImages: (sessionId: string, images: ComposerImageDraft[]) => void;
  addComposerImages: (sessionId: string, images: ComposerImageDraft[]) => void;
  removeComposerImage: (sessionId: string, imageId: string) => void;
  clearComposerDraft: (sessionId: string) => void;
  clearComposerImages: (sessionId: string) => void;
  applyRuntimeEvent: (event: PiRuntimeEvent) => void;
  applyTerminalEvent: (event: TerminalEvent) => void;
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

function createTerminalState(id: string): TerminalSessionState {
  return {
    id,
    status: "idle",
    buffer: "",
  };
}

function createWorkspaceTerminalState(
  workspaceId: string,
): WorkspaceTerminalState {
  return {
    workspaceId,
    activeTabId: null,
    tabOrder: [],
    tabs: {},
  };
}

function ensureWorkspaceTerminal(
  terminals: Record<string, WorkspaceTerminalState>,
  workspaceId: string,
) {
  return terminals[workspaceId] ?? createWorkspaceTerminalState(workspaceId);
}

function upsertTerminalTab(
  workspaceTerminals: WorkspaceTerminalState,
  terminalTabId: string,
) {
  const exists = Boolean(workspaceTerminals.tabs[terminalTabId]);
  return {
    ...workspaceTerminals,
    activeTabId: workspaceTerminals.activeTabId ?? terminalTabId,
    tabOrder: exists
      ? workspaceTerminals.tabOrder
      : [...workspaceTerminals.tabOrder, terminalTabId],
    tabs: {
      ...workspaceTerminals.tabs,
      [terminalTabId]:
        workspaceTerminals.tabs[terminalTabId] ??
        createTerminalState(terminalTabId),
    },
  };
}

function removeTerminalTabState(
  workspaceTerminals: WorkspaceTerminalState,
  terminalTabId: string,
) {
  const nextTabs = { ...workspaceTerminals.tabs };
  delete nextTabs[terminalTabId];
  const nextTabOrder = workspaceTerminals.tabOrder.filter(
    (id) => id !== terminalTabId,
  );
  return {
    ...workspaceTerminals,
    tabs: nextTabs,
    tabOrder: nextTabOrder,
    activeTabId:
      workspaceTerminals.activeTabId === terminalTabId
        ? (nextTabOrder[nextTabOrder.length - 1] ?? null)
        : workspaceTerminals.activeTabId,
  };
}

function createTerminalTabId() {
  return crypto.randomUUID();
}

function trimTerminalBuffer(buffer: string) {
  const maxBuffer = 250_000;
  return buffer.length > maxBuffer ? buffer.slice(-maxBuffer) : buffer;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  isBootstrapping: true,
  connectionReady: false,
  commandPaletteOpen: false,
  terminalPaneOpen: false,
  state: null,
  git: {},
  terminals: {},
  customActions: {},
  currentMode: "build",
  workspaceCatalogs: {},
  workspaceCatalogStatus: {},
  workspaceCatalogLoaded: {},
  workspaceCatalogErrors: {},
  composerDrafts: {},
  composerImageDrafts: {},
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
  setTerminalPaneOpen(terminalPaneOpen) {
    set({ terminalPaneOpen });
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
  async createSession(workspaceId, options) {
    const store = get();
    const workspace = store.state?.workspaces.find((w) => w.id === workspaceId);
    if (workspace && !options?.forceNew) {
      const emptySession = workspace.sessions.find(
        (s) => !s.timeline.some((t) => t.kind === "user-message"),
      );
      if (emptySession) {
        await store.selectWorkspaceSession(workspaceId, emptySession.id);
        return emptySession.id;
      }
    }

    const state = await createSessionCommand({ workspaceId });
    set({ state });
    return state.activeSessionId;
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
      const nextCatalogStatus = { ...store.workspaceCatalogStatus };
      const nextCatalogLoaded = { ...store.workspaceCatalogLoaded };
      const nextErrors = { ...store.workspaceCatalogErrors };
      const nextTerminals = { ...store.terminals };
      delete nextCatalogs[workspaceId];
      delete nextCatalogStatus[workspaceId];
      delete nextCatalogLoaded[workspaceId];
      delete nextErrors[workspaceId];
      delete nextTerminals[workspaceId];
      return {
        state,
        workspaceCatalogs: nextCatalogs,
        workspaceCatalogStatus: nextCatalogStatus,
        workspaceCatalogLoaded: nextCatalogLoaded,
        workspaceCatalogErrors: nextErrors,
        terminals: nextTerminals,
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
  async moveWorkspace(workspaceId, beforeWorkspaceId) {
    const state = await moveWorkspaceCommand({
      workspaceId,
      beforeWorkspaceId,
    });
    set({ state });
  },
  async moveSession(workspaceId, sessionId, beforeSessionId) {
    const state = await moveSessionCommand({
      workspaceId,
      sessionId,
      beforeSessionId,
    });
    set({ state });
  },
  async undoUserTurn(workspaceId, sessionId, userMessageId) {
    const composerMessage = getUndoComposerMessage(
      get().state,
      workspaceId,
      sessionId,
      userMessageId,
    );
    const state = await undoUserTurnCommand({
      workspaceId,
      sessionId,
      userMessageId,
    });
    set({ state });
    if (composerMessage) {
      get().setComposerDraft(sessionId, composerMessage.content);
      get().setComposerImages(
        sessionId,
        composerMessage.images.map((image) => ({
          id: crypto.randomUUID(),
          ...image,
        })),
      );
    }
    await get().refreshGit(workspaceId);
  },
  async redoUserTurn(workspaceId, sessionId, userMessageId) {
    const state = await redoUserTurnCommand({
      workspaceId,
      sessionId,
      userMessageId,
    });
    set({ state });
    await get().refreshGit(workspaceId);
  },
  async sendPrompt(workspaceId, sessionId, prompt, mode, images = []) {
    const createdAt = new Date().toISOString();
    const userMessageId = crypto.randomUUID();
    set((store) => {
      if (!store.state) {
        return store;
      }

      const nextState = structuredClone(store.state);
      const { session } = findSession(nextState, workspaceId, sessionId);
      if (!session) {
        return store;
      }

      session.timeline.push({
        id: userMessageId,
        kind: "user-message",
        content: prompt,
        images,
        createdAt,
      });
      session.status = "streaming";
      session.updatedAt = createdAt;

      return { state: nextState };
    });

    try {
      await sendPromptCommand({
        workspaceId,
        sessionId,
        userMessageId,
        prompt,
        mode,
        images,
      });
    } catch (error) {
      set((store) => {
        if (!store.state) {
          return {
            runtimeGlobalError:
              error instanceof Error ? error.message : String(error),
          };
        }

        const nextState = structuredClone(store.state);
        const { session } = findSession(nextState, workspaceId, sessionId);
        if (session) {
          session.status = "error";
          session.timeline.push({
            id: crypto.randomUUID(),
            kind: "error",
            title: "Send failed",
            detail: error instanceof Error ? error.message : String(error),
            createdAt: new Date().toISOString(),
          });
        }

        return {
          state: nextState,
          runtimeGlobalError:
            error instanceof Error ? error.message : String(error),
        };
      });
      throw error;
    }
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
  async ensureTerminalSession(workspaceId, terminalTabId) {
    set((store) => ({
      terminals: {
        ...store.terminals,
        [workspaceId]: (() => {
          const workspaceTerminals = upsertTerminalTab(
            ensureWorkspaceTerminal(store.terminals, workspaceId),
            terminalTabId,
          );
          const current = workspaceTerminals.tabs[terminalTabId];
          return {
            ...workspaceTerminals,
            activeTabId: terminalTabId,
            tabs: {
              ...workspaceTerminals.tabs,
              [terminalTabId]: {
                ...current,
                status: current.status === "ready" ? "ready" : "connecting",
                error: undefined,
              },
            },
          };
        })(),
      },
    }));
    await ensureTerminalSessionCommand({ workspaceId, terminalTabId });
  },
  async closeTerminalTab(workspaceId, terminalTabId) {
    set((store) => {
      const workspaceTerminals = store.terminals[workspaceId];
      if (!workspaceTerminals) {
        return store;
      }

      return {
        terminals: {
          ...store.terminals,
          [workspaceId]: removeTerminalTabState(
            workspaceTerminals,
            terminalTabId,
          ),
        },
      };
    });

    try {
      await closeTerminalSessionCommand({ workspaceId, terminalTabId });
    } catch {
      // Ignore missing/stale PTY errors when closing local UI state.
    }
  },
  async createTerminalTab(workspaceId) {
    const terminalTabId = createTerminalTabId();
    set((store) => ({
      terminalPaneOpen: true,
      terminals: {
        ...store.terminals,
        [workspaceId]: {
          ...upsertTerminalTab(
            ensureWorkspaceTerminal(store.terminals, workspaceId),
            terminalTabId,
          ),
          activeTabId: terminalTabId,
        },
      },
    }));
    await get().ensureTerminalSession(workspaceId, terminalTabId);
    return terminalTabId;
  },
  renameTerminalTab(workspaceId, terminalTabId, title) {
    set((store) => {
      const workspaceTerminals = store.terminals[workspaceId];
      const terminal = workspaceTerminals?.tabs[terminalTabId];
      if (!workspaceTerminals || !terminal) {
        return store;
      }

      const nextTitle = title.trim();

      return {
        terminals: {
          ...store.terminals,
          [workspaceId]: {
            ...workspaceTerminals,
            tabs: {
              ...workspaceTerminals.tabs,
              [terminalTabId]: {
                ...terminal,
                title: nextTitle || undefined,
              },
            },
          },
        },
      };
    });
  },
  setActiveTerminalTab(workspaceId, terminalTabId) {
    set((store) => {
      const workspaceTerminals = store.terminals[workspaceId];
      if (!workspaceTerminals?.tabs[terminalTabId]) {
        return store;
      }

      return {
        terminals: {
          ...store.terminals,
          [workspaceId]: {
            ...workspaceTerminals,
            activeTabId: terminalTabId,
          },
        },
      };
    });
  },
  clearTerminalBuffer(workspaceId, terminalTabId) {
    set((store) => {
      const workspaceTerminals = store.terminals[workspaceId];
      const terminal = workspaceTerminals?.tabs[terminalTabId];
      if (!workspaceTerminals || !terminal) {
        return store;
      }

      return {
        terminals: {
          ...store.terminals,
          [workspaceId]: {
            ...workspaceTerminals,
            tabs: {
              ...workspaceTerminals.tabs,
              [terminalTabId]: {
                ...terminal,
                buffer: "",
                error: undefined,
              },
            },
          },
        },
      };
    });
  },
  async restartTerminalTab(workspaceId, terminalTabId) {
    const currentTitle =
      get().terminals[workspaceId]?.tabs[terminalTabId]?.title;

    await get().closeTerminalTab(workspaceId, terminalTabId);
    set((store) => ({
      terminals: {
        ...store.terminals,
        [workspaceId]: {
          ...upsertTerminalTab(
            ensureWorkspaceTerminal(store.terminals, workspaceId),
            terminalTabId,
          ),
          activeTabId: terminalTabId,
          tabs: {
            ...upsertTerminalTab(
              ensureWorkspaceTerminal(store.terminals, workspaceId),
              terminalTabId,
            ).tabs,
            [terminalTabId]: {
              ...createTerminalState(terminalTabId),
              title: currentTitle,
            },
          },
        },
      },
    }));
    await get().ensureTerminalSession(workspaceId, terminalTabId);
  },
  async writeTerminalInput(workspaceId, terminalTabId, data) {
    await writeTerminalInputCommand({ workspaceId, terminalTabId, data });
  },
  async resizeTerminal(workspaceId, terminalTabId, cols, rows) {
    const safeCols = Math.max(2, Math.floor(cols));
    const safeRows = Math.max(2, Math.floor(rows));
    await resizeTerminalCommand({
      workspaceId,
      terminalTabId,
      cols: safeCols,
      rows: safeRows,
    });
  },
  async runTerminalCommand(workspaceId, command, options) {
    if (!command.trim()) {
      return;
    }

    if (options?.openPane !== false) {
      get().setTerminalPaneOpen(true);
    }

    const terminalTabId =
      options?.terminalTabId ??
      get().terminals[workspaceId]?.activeTabId ??
      (await get().createTerminalTab(workspaceId));

    await get().ensureTerminalSession(workspaceId, terminalTabId);
    const result = await runTerminalCommandCommand({
      workspaceId,
      terminalTabId,
      command,
      refreshGit: options?.refreshGit,
    });

    set((store) => {
      const workspaceTerminals = upsertTerminalTab(
        ensureWorkspaceTerminal(store.terminals, workspaceId),
        result.terminalTabId,
      );
      const terminal = workspaceTerminals.tabs[result.terminalTabId];
      return {
        terminals: {
          ...store.terminals,
          [workspaceId]: {
            ...workspaceTerminals,
            activeTabId: result.terminalTabId,
            tabs: {
              ...workspaceTerminals.tabs,
              [result.terminalTabId]: {
                ...terminal,
                status: "ready",
                activeCommand: {
                  id: result.commandId,
                  command,
                },
                error: undefined,
              },
            },
          },
        },
      };
    });
  },
  async refreshRuntimeHealth() {
    const payload = await runtimeHealthcheckCommand();
    set((store) => ({
      runtimeInstall: payload.install,
      runtimeGlobalError: undefined,
      workspaceCatalogs:
        payload.install.status === "ready" ? store.workspaceCatalogs : {},
      workspaceCatalogStatus:
        payload.install.status === "ready" ? store.workspaceCatalogStatus : {},
      workspaceCatalogLoaded:
        payload.install.status === "ready" ? store.workspaceCatalogLoaded : {},
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

    set((store) => ({
      workspaceCatalogStatus: {
        ...store.workspaceCatalogStatus,
        [workspaceId]: "loading",
      },
      workspaceCatalogLoaded: {
        ...store.workspaceCatalogLoaded,
        [workspaceId]: store.workspaceCatalogLoaded[workspaceId] ?? false,
      },
      workspaceCatalogErrors: {
        ...store.workspaceCatalogErrors,
        [workspaceId]: undefined,
      },
    }));

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
            workspaceCatalogLoaded: {
              ...store.workspaceCatalogLoaded,
              [workspaceId]: true,
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
          workspaceCatalogStatus: {
            ...store.workspaceCatalogStatus,
            [workspaceId]: "ready",
          },
          workspaceCatalogLoaded: {
            ...store.workspaceCatalogLoaded,
            [workspaceId]: true,
          },
          workspaceCatalogErrors: {
            ...store.workspaceCatalogErrors,
            [workspaceId]: undefined,
          },
        };
      });
    } catch (error) {
      set((store) => ({
        workspaceCatalogStatus: {
          ...store.workspaceCatalogStatus,
          [workspaceId]: "error",
        },
        workspaceCatalogLoaded: {
          ...store.workspaceCatalogLoaded,
          [workspaceId]: true,
        },
        workspaceCatalogErrors: {
          ...store.workspaceCatalogErrors,
          [workspaceId]: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  },
  setComposerDraft(sessionId, draft) {
    set((store) => ({
      composerDrafts: {
        ...store.composerDrafts,
        [sessionId]: draft,
      },
    }));
  },
  setComposerImages(sessionId, images) {
    set((store) => ({
      composerImageDrafts: {
        ...store.composerImageDrafts,
        [sessionId]: images,
      },
    }));
  },
  addComposerImages(sessionId, images) {
    if (images.length === 0) {
      return;
    }
    set((store) => ({
      composerImageDrafts: {
        ...store.composerImageDrafts,
        [sessionId]: [
          ...(store.composerImageDrafts[sessionId] ?? []),
          ...images,
        ],
      },
    }));
  },
  removeComposerImage(sessionId, imageId) {
    set((store) => {
      const currentImages = store.composerImageDrafts[sessionId] ?? [];
      return {
        composerImageDrafts: {
          ...store.composerImageDrafts,
          [sessionId]: currentImages.filter((image) => image.id !== imageId),
        },
      };
    });
  },
  clearComposerDraft(sessionId) {
    set((store) => {
      const nextDrafts = { ...store.composerDrafts };
      delete nextDrafts[sessionId];
      return { composerDrafts: nextDrafts };
    });
  },
  clearComposerImages(sessionId) {
    set((store) => {
      const nextImages = { ...store.composerImageDrafts };
      delete nextImages[sessionId];
      return { composerImageDrafts: nextImages };
    });
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
            existing.content = event.content || existing.content;
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
          session.updatedAt = new Date().toISOString();
          break;
        }
        case "session-titled": {
          const { session } = findSession(
            state,
            event.workspaceId,
            event.sessionId,
          );
          if (!session) {
            return store;
          }
          session.title = event.title;
          session.updatedAt = new Date().toISOString();
          break;
        }
      }

      return { ...store, state };
    });
  },
  applyTerminalEvent(event) {
    set((store) => {
      const workspaceTerminals = store.terminals[event.workspaceId];
      if (!workspaceTerminals?.tabs[event.terminalTabId]) {
        return store;
      }

      const current = workspaceTerminals.tabs[event.terminalTabId];

      switch (event.type) {
        case "started":
          return {
            terminals: {
              ...store.terminals,
              [event.workspaceId]: {
                ...workspaceTerminals,
                activeTabId: event.terminalTabId,
                tabs: {
                  ...workspaceTerminals.tabs,
                  [event.terminalTabId]: {
                    ...current,
                    status: "ready",
                    error: undefined,
                  },
                },
              },
            },
          };
        case "output":
          return {
            terminals: {
              ...store.terminals,
              [event.workspaceId]: {
                ...workspaceTerminals,
                tabs: {
                  ...workspaceTerminals.tabs,
                  [event.terminalTabId]: {
                    ...current,
                    status:
                      current.status === "connecting"
                        ? "ready"
                        : current.status,
                    buffer: trimTerminalBuffer(current.buffer + event.chunk),
                  },
                },
              },
            },
          };
        case "command-finished":
          return {
            git: event.gitSnapshot
              ? { ...store.git, [event.workspaceId]: event.gitSnapshot }
              : store.git,
            terminals: {
              ...store.terminals,
              [event.workspaceId]: {
                ...workspaceTerminals,
                tabs: {
                  ...workspaceTerminals.tabs,
                  [event.terminalTabId]: {
                    ...current,
                    status: "ready",
                    activeCommand:
                      current.activeCommand?.id === event.commandId
                        ? undefined
                        : current.activeCommand,
                    lastCommand: {
                      id: event.commandId,
                      command: event.command,
                      exitCode: event.exitCode,
                    },
                    error:
                      event.exitCode === 0
                        ? undefined
                        : `Command exited with code ${event.exitCode}`,
                  },
                },
              },
            },
          };
        case "error":
          return {
            terminals: {
              ...store.terminals,
              [event.workspaceId]: {
                ...workspaceTerminals,
                tabs: {
                  ...workspaceTerminals.tabs,
                  [event.terminalTabId]: {
                    ...current,
                    status: "error",
                    error: event.message,
                  },
                },
              },
            },
          };
        case "exit":
          return {
            terminals: {
              ...store.terminals,
              [event.workspaceId]: {
                ...workspaceTerminals,
                tabs: {
                  ...workspaceTerminals.tabs,
                  [event.terminalTabId]: {
                    ...current,
                    status: "exited",
                    activeCommand: undefined,
                    error:
                      event.exitCode === undefined
                        ? current.error
                        : `Shell exited with code ${event.exitCode}`,
                  },
                },
              },
            },
          };
      }
    });
  },
}));
