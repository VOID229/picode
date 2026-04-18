import { startTransition } from "react";
import { create } from "zustand";
import type {
  GitSnapshot,
  PersistedAppState,
  PiRuntimeEvent,
  TimelineItem,
  WorkspaceRecord,
} from "../domains/types";
import {
  bootstrapState,
  createSession as createSessionCommand,
  createWorkspace as createWorkspaceCommand,
  refreshGit as refreshGitCommand,
  resolveApproval as resolveApprovalCommand,
  selectWorkspaceSession as selectWorkspaceSessionCommand,
  sendPrompt as sendPromptCommand,
  updatePreferences as updatePreferencesCommand,
  updateWorkspaceSettings as updateWorkspaceSettingsCommand,
  renameWorkspace as renameWorkspaceCommand,
  removeWorkspace as removeWorkspaceCommand,
  renameSession as renameSessionCommand,
  deleteSession as deleteSessionCommand,
} from "../lib/tauri";

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
  initialize: () => Promise<void>;
  setConnectionReady: (ready: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setCurrentMode: (mode: "plan" | "build") => void;
  addCustomAction: (workspaceId: string, action: Omit<CustomAction, "id">) => void;
  updateCustomAction: (workspaceId: string, actionId: string, action: Omit<CustomAction, "id">) => void;
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
  renameSession: (workspace_id: string, session_id: string, title: string) => Promise<void>;
  deleteSession: (workspace_id: string, session_id: string) => Promise<void>;
  sendPrompt: (
    workspaceId: string,
    sessionId: string,
    prompt: string,
  ) => Promise<void>;
  resolveApproval: (
    workspaceId: string,
    sessionId: string,
    approvalId: string,
    decision: "approved" | "rejected",
  ) => Promise<void>;
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

export const useAppStore = create<AppStoreState>((set, get) => ({
  isBootstrapping: true,
  connectionReady: false,
  commandPaletteOpen: false,
  state: null,
  git: {},
  customActions: {},
  currentMode: "build",
  async initialize() {
    set({ isBootstrapping: true });
    const payload = await bootstrapState();
    set({
      isBootstrapping: false,
      state: payload.state,
      git: payload.git,
      connectionReady: true,
    });
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
          [workspaceId]: actions.map((a) => a.id === actionId ? { ...updatedAction, id: actionId } : a),
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
    set({ state });
  },
  async renameSession(workspaceId, sessionId, title) {
    const state = await renameSessionCommand(workspaceId, sessionId, title);
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
  async resolveApproval(workspaceId, sessionId, approvalId, decision) {
    const state = await resolveApprovalCommand({
      workspaceId,
      sessionId,
      approvalId,
      decision,
    });
    set({ state });
  },
  applyRuntimeEvent(event) {
    set((store) => {
      if (!store.state) {
        return store;
      }

      const state = structuredClone(store.state);
      const { session } = findSession(
        state,
        event.workspaceId,
        event.sessionId,
      );

      if (!session) {
        return store;
      }

      switch (event.type) {
        case "token": {
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
          break;
        }
        case "tool-start": {
          pushOrReplaceTimelineItem(session, {
            id: event.activity.id,
            kind: "tool-activity",
            activity: event.activity,
            createdAt: event.activity.startedAt,
          });
          break;
        }
        case "tool-output": {
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
          session.timeline.push({
            id: crypto.randomUUID(),
            kind: "error",
            title: "Runtime error",
            detail: event.message,
            createdAt: new Date().toISOString(),
          });
          session.status = "error";
          break;
        }
        case "done": {
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
          break;
        }
      }

      return { state };
    });
  },
}));
