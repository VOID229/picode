import { ArrowUp, Bot, Check, FileText, Square, Zap } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import type {
  ChatSession,
  TimelineItem,
  ToolActivityItem,
  WorkspaceRecord,
} from "../../domains/types";
import { useAppStore } from "../../state/useAppStore";
import { FilesChangedBlock } from "./FilesChangedBlock";
import { ImageAttachmentGallery } from "./ImageAttachmentGallery";
import { TimelineItemView } from "./TimelineItemView";
import { ToolActivityGroup } from "./ToolActivityGroup";
import { WorkedForBlock } from "./WorkedForBlock";
import {
  deriveLivePhase,
  extractFileChanges,
  resolveComposerCapabilities,
  resolveSessionSelection,
  segmentTurnItems,
  type TurnSegment,
} from "./chatRuntime";
import {
  fileToComposerImageDraft,
  rgbaClipboardImageToComposerImageDraft,
} from "../../lib/messageImages";

interface ConversationViewProps {
  workspace: WorkspaceRecord | null;
  session: ChatSession | null;
}

export function ConversationView({
  workspace,
  session,
}: ConversationViewProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [effortDropdownOpen, setEffortDropdownOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  const runtimeInstall = useAppStore((store) => store.runtimeInstall);
  const stateProviders = useAppStore((store) => store.state?.providers ?? []);
  const workspaceCatalogs = useAppStore((store) => store.workspaceCatalogs);
  const workspaceCatalogStatus = useAppStore(
    (store) => store.workspaceCatalogStatus,
  );
  const workspaceCatalogErrors = useAppStore(
    (store) => store.workspaceCatalogErrors,
  );
  const workspaceCatalogLoaded = useAppStore(
    (store) => store.workspaceCatalogLoaded,
  );
  const composerDrafts = useAppStore((store) => store.composerDrafts);
  const composerImageDrafts = useAppStore((store) => store.composerImageDrafts);
  const currentMode = useAppStore((store) => store.currentMode);
  const setCurrentMode = useAppStore((store) => store.setCurrentMode);
  const setComposerDraft = useAppStore((store) => store.setComposerDraft);
  const addComposerImages = useAppStore((store) => store.addComposerImages);
  const removeComposerImage = useAppStore((store) => store.removeComposerImage);
  const clearComposerDraft = useAppStore((store) => store.clearComposerDraft);
  const clearComposerImages = useAppStore((store) => store.clearComposerImages);
  const sendPrompt = useAppStore((state) => state.sendPrompt);
  const abortPrompt = useAppStore((state) => state.abortPrompt);
  const resolveApproval = useAppStore((state) => state.resolveApproval);
  const undoUserTurn = useAppStore((state) => state.undoUserTurn);
  const updateWorkspaceSettings = useAppStore(
    (store) => store.updateWorkspaceSettings,
  );

  const closeComposerMenus = () => {
    setProviderDropdownOpen(false);
    setModelDropdownOpen(false);
    setEffortDropdownOpen(false);
  };

  const toggleComposerMenu = (menu: "provider" | "model" | "effort") => {
    setProviderDropdownOpen((current) =>
      menu === "provider" ? !current : false,
    );
    setModelDropdownOpen((current) => (menu === "model" ? !current : false));
    setEffortDropdownOpen((current) => (menu === "effort" ? !current : false));
  };

  const sessionDraft = session ? (composerDrafts[session.id] ?? "") : "";
  const sessionImages = session ? (composerImageDrafts[session.id] ?? []) : [];
  const canSubmit = sessionDraft.trim().length > 0 || sessionImages.length > 0;

  const handleSubmit = async () => {
    const value = sessionDraft.trim();
    const images = sessionImages.map(({ id, ...image }) => image);
    if (!workspace || !session || (!value && images.length === 0)) {
      return;
    }

    closeComposerMenus();
    clearComposerDraft(session.id);
    clearComposerImages(session.id);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      await sendPrompt(workspace.id, session.id, value, currentMode, images);
    } catch (error) {
      setComposerDraft(session.id, value);
      addComposerImages(
        session.id,
        images.map((image) => ({
          id: crypto.randomUUID(),
          ...image,
        })),
      );
      throw error;
    }
  };

  const handleComposerPaste = useCallback(
    async (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const sessionId = session?.id;
      if (!sessionId) {
        return;
      }

      const clipboard = event.clipboardData;
      const clipboardItems = Array.from(clipboard?.items ?? []);
      const imageFiles = clipboardItems
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      const hasTextPayload = Boolean(
        clipboard?.getData("text/plain") || clipboard?.getData("text/html"),
      );

      if (imageFiles.length > 0) {
        if (!hasTextPayload) {
          event.preventDefault();
        }

        try {
          const nextImages = await Promise.all(
            imageFiles.map((file) => fileToComposerImageDraft(file)),
          );
          addComposerImages(sessionId, nextImages);
        } catch (error) {
          window.alert(
            error instanceof Error
              ? error.message
              : "Unable to read the pasted image.",
          );
        }
        return;
      }

      if (hasTextPayload) {
        return;
      }

      try {
        const { readImage } =
          await import("@tauri-apps/plugin-clipboard-manager");
        const clipboardImage = await readImage();
        const size = await clipboardImage.size();
        const rgba = await clipboardImage.rgba();
        const nextImage = await rgbaClipboardImageToComposerImageDraft({
          rgba,
          width: size.width,
          height: size.height,
        });
        event.preventDefault();
        addComposerImages(sessionId, [nextImage]);
      } catch {
        // Ignore fallback failures so regular text pastes continue untouched.
      }
    },
    [addComposerImages, session?.id],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [sessionDraft, session?.id]);

  useEffect(() => {
    if (timelineRef.current && shouldStickToBottomRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [session?.timeline.length, session?.status]);

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) {
      return;
    }

    const updateStickiness = () => {
      shouldStickToBottomRef.current =
        node.scrollHeight - node.scrollTop - node.clientHeight < 120;
    };

    updateStickiness();
    node.addEventListener("scroll", updateStickiness);
    return () => node.removeEventListener("scroll", updateStickiness);
  }, [session?.id]);

  const livePhase = useMemo(() => deriveLivePhase(session), [session]);

  // Split timeline into "turns" — segments between user messages —
  // so we can group tool activities and wrap completed turns.
  const turns = useMemo(() => {
    if (!session) return [];
    return computeTurns(session.timeline, session.status, livePhase);
  }, [livePhase, session]);

  const handleUndo = useCallback(
    async (userMessageId: string) => {
      if (!workspace || !session) return;
      const git = useAppStore.getState().git[workspace.id];
      if (!git?.isRepo) {
        window.alert(
          "Undo is only available for git workspaces with a saved checkpoint for this turn.",
        );
        return;
      }
      const confirmed = window.confirm(
        "Undo this message and everything after it? This restores the working tree and index to the saved checkpoint only if HEAD has not changed.",
      );
      if (!confirmed) return;
      try {
        await undoUserTurn(workspace.id, session.id, userMessageId);
      } catch (error) {
        window.alert(
          error instanceof Error
            ? error.message
            : "Undo is unavailable for this message.",
        );
      }
    },
    [workspace, session, undoUserTurn],
  );

  useEffect(() => {
    if (!workspace || !session) {
      return;
    }

    const workspaceProviders = workspaceCatalogs[workspace.id] ?? [];
    const displayProviders =
      workspaceProviders.length > 0 ? workspaceProviders : stateProviders;
    const selection = resolveSessionSelection(session, workspace);
    const capabilities = resolveComposerCapabilities({
      providers: displayProviders,
      selection,
    });

    if (
      selection.providerId === capabilities.normalizedSelection.providerId &&
      selection.modelId === capabilities.normalizedSelection.modelId &&
      selection.effort === capabilities.normalizedSelection.effort &&
      selection.fastMode === capabilities.normalizedSelection.fastMode
    ) {
      return;
    }

    void updateWorkspaceSettings({
      workspaceId: workspace.id,
      sessionId: session.id,
      approvalMode: workspace.approvalMode,
      providerId: capabilities.normalizedSelection.providerId,
      modelId: capabilities.normalizedSelection.modelId,
      effort: capabilities.normalizedSelection.effort,
      fastMode: capabilities.normalizedSelection.fastMode,
      policy: workspace.policy,
    });
  }, [
    session,
    stateProviders,
    updateWorkspaceSettings,
    workspace,
    workspaceCatalogs,
  ]);

  if (!workspace || !session) {
    return (
      <div className="empty-state" style={{ color: "#555" }}>
        Select a thread to continue.
      </div>
    );
  }

  const hasUserMessage = session.timeline.some(
    (item) => item.kind === "user-message",
  );
  const isEmptySpace = !hasUserMessage;

  const workspaceProviders = workspaceCatalogs[workspace.id] ?? [];
  const catalogStatus = workspaceCatalogStatus[workspace.id] ?? "idle";
  const workspaceCatalogError = workspaceCatalogErrors[workspace.id];
  const displayProviders =
    workspaceProviders.length > 0 ? workspaceProviders : stateProviders;
  const selection = resolveSessionSelection(session, workspace);
  const activeProvider = displayProviders.find(
    (provider) => provider.id === selection.providerId,
  );
  const activeModel =
    activeProvider?.models.find((model) => model.id === selection.modelId) ??
    displayProviders
      .flatMap((provider) => provider.models)
      .find((model) => model.id === selection.modelId);
  const composerCapabilities = resolveComposerCapabilities({
    providers: displayProviders,
    selection,
  });
  const effortLabels = Object.fromEntries(
    composerCapabilities.effortOptions.map((entry) => [entry.id, entry.label]),
  );
  const normalizedSelection = composerCapabilities.normalizedSelection;

  const hasWorkspaceCatalog = workspaceProviders.length > 0;
  const catalogLoaded = workspaceCatalogLoaded[workspace.id] ?? false;
  const sendDisabledReason =
    runtimeInstall?.status === "missing"
      ? "The local runtime is not installed. Install it from Settings > Connections."
      : runtimeInstall?.status === "broken"
        ? "The local runtime did not respond correctly. Check the runtime path in Settings."
        : catalogStatus === "error"
          ? workspaceCatalogError ||
            "Unable to load models for this project. Refresh the runtime in Settings."
          : runtimeInstall?.status === "ready" &&
              catalogLoaded &&
              catalogStatus === "ready" &&
              workspaceProviders.length === 0
            ? "No models are configured for this project. Run `pi` in the project and configure a provider, or update your config."
            : undefined;
  const sendDisabled = Boolean(sendDisabledReason);

  const currentEffortLabel = effortLabels[normalizedSelection.effort] || "High";

  return (
    <div
      className="conversation-view"
      style={{
        padding: "0 24px 24px",
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "var(--bg)",
      }}
    >
      {isEmptySpace ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#555",
          }}
        >
          Send a message to start the conversation.
        </div>
      ) : (
        <div
          className="timeline"
          ref={timelineRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            paddingBottom: "24px",
          }}
        >
          <div
            className="message-outer"
            style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          >
            {turns.map((turn, turnIndex) => (
              <TurnRenderer
                key={turn.userMessageId ?? `turn-${turnIndex}`}
                turn={turn}
                workspaceId={workspace.id}
                sessionId={session.id}
                onResolveApproval={resolveApproval}
                onUndo={handleUndo}
              />
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "800px",
          margin: "0 auto",
        }}
      >
        {sendDisabledReason && (
          <div
            style={{
              marginBottom: "12px",
              border: "1px solid #2a2a2c",
              borderRadius: "10px",
              padding: "10px 12px",
              background: "rgba(255,255,255,0.03)",
              color: "#c4c4c7",
              fontSize: "0.82rem",
              lineHeight: 1.5,
            }}
          >
            {sendDisabledReason}
          </div>
        )}
        {sessionImages.length > 0 && (
          <div style={{ marginBottom: "10px" }}>
            <ImageAttachmentGallery
              images={sessionImages}
              align="start"
              onRemove={(image) => {
                if (!image.id || !session) {
                  return;
                }
                removeComposerImage(session.id, image.id);
              }}
            />
          </div>
        )}
        <div
          style={{
            background: "#18181A",
            border: `1px solid ${isFocused ? "#2563eb" : "#333"}`,
            borderRadius: "12px",
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            transition: "border-color 0.2s",
            boxShadow: isFocused ? "0 0 0 1px #2563eb" : "none",
          }}
        >
          <textarea
            ref={textareaRef}
            value={sessionDraft}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onChange={(event) => {
              if (!session) {
                return;
              }
              setComposerDraft(session.id, event.target.value);
            }}
            onPaste={(event) => {
              void handleComposerPaste(event);
            }}
            placeholder="Ask for follow-up changes or attach images"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!sendDisabled && canSubmit) {
                  void handleSubmit();
                }
              }
            }}
            disabled={sendDisabled}
            rows={1}
            aria-label="Message composer"
            style={{
              background: "transparent",
              border: "none",
              resize: "none",
              color: "#eaeaea",
              fontSize: "0.95rem",
              outline: "none",
              maxHeight: "200px",
            }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: "4px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                color: "#666",
                fontSize: "0.8rem",
              }}
            >
              <div
                className="composer-select-wrapper pointer"
                onClick={() => {
                  if (hasWorkspaceCatalog) {
                    toggleComposerMenu("provider");
                  }
                }}
              >
                <span style={{ paddingRight: "4px" }}>
                  {activeProvider?.label ||
                    (catalogStatus === "loading"
                      ? "Loading providers..."
                      : runtimeInstall?.status === "ready"
                        ? "Provider"
                        : "Runtime unavailable")}
                </span>
                <ChevronIcon />
                {providerDropdownOpen && hasWorkspaceCatalog && (
                  <>
                    <div
                      style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10,
                        cursor: "default",
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeComposerMenus();
                      }}
                    />
                    <div
                      className="custom-dropdown"
                      style={{ minWidth: "200px" }}
                    >
                      {workspaceProviders.map((provider) => (
                        <div
                          key={provider.id}
                          className="custom-dropdown-item"
                          style={{ justifyContent: "space-between" }}
                          onClick={(event) => {
                            event.stopPropagation();
                            closeComposerMenus();
                            void updateWorkspaceSettings({
                              workspaceId: workspace.id,
                              sessionId: session.id,
                              approvalMode: workspace.approvalMode,
                              providerId: provider.id,
                              modelId:
                                provider.models[0]?.id ??
                                normalizedSelection.modelId,
                              effort: normalizedSelection.effort,
                              fastMode: normalizedSelection.fastMode,
                              policy: workspace.policy,
                            });
                          }}
                        >
                          <span>{provider.label}</span>
                          {normalizedSelection.providerId === provider.id && (
                            <Check size={14} />
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div
                style={{ width: "1px", height: "12px", background: "#333" }}
              />

              <div
                className="composer-select-wrapper pointer"
                onClick={() => {
                  if (hasWorkspaceCatalog) {
                    toggleComposerMenu("model");
                  }
                }}
              >
                <Bot size={14} />
                <span style={{ paddingRight: "4px" }}>
                  {activeModel?.label ||
                    (catalogStatus === "loading"
                      ? "Loading models..."
                      : runtimeInstall?.status === "ready"
                        ? "Select model"
                        : "Runtime unavailable")}
                </span>
                <ChevronIcon />
                {modelDropdownOpen && hasWorkspaceCatalog && (
                  <>
                    <div
                      style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 10,
                        cursor: "default",
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeComposerMenus();
                      }}
                    />
                    <div
                      className="custom-dropdown"
                      style={{ minWidth: "220px" }}
                    >
                      {activeProvider?.models.map((model) => (
                        <div
                          key={model.id}
                          className="custom-dropdown-item"
                          style={{ justifyContent: "space-between" }}
                          onClick={(event) => {
                            event.stopPropagation();
                            closeComposerMenus();
                            void updateWorkspaceSettings({
                              workspaceId: workspace.id,
                              sessionId: session.id,
                              approvalMode: workspace.approvalMode,
                              providerId: normalizedSelection.providerId,
                              modelId: model.id,
                              effort: normalizedSelection.effort,
                              fastMode: normalizedSelection.fastMode,
                              policy: workspace.policy,
                            });
                          }}
                        >
                          <span>{model.label}</span>
                          {normalizedSelection.modelId === model.id && (
                            <Check size={14} />
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div
                style={{ width: "1px", height: "12px", background: "#333" }}
              />

              <div
                className="composer-select-wrapper pointer"
                onClick={() => toggleComposerMenu("effort")}
              >
                <span style={{ paddingRight: "4px" }}>
                  {currentEffortLabel.split(" ")[0]}
                </span>
                <ChevronIcon />
                {effortDropdownOpen &&
                  (composerCapabilities.effortOptions.length > 0 ||
                    composerCapabilities.supportsFastMode) && (
                    <>
                      <div
                        style={{
                          position: "fixed",
                          inset: 0,
                          zIndex: 10,
                          cursor: "default",
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          closeComposerMenus();
                        }}
                      />
                      <div
                        className="custom-dropdown"
                        style={{ minWidth: "160px" }}
                      >
                        <div className="dropdown-section-label">Effort</div>
                        {composerCapabilities.effortOptions.map(
                          ({ id, label }) => (
                            <div
                              key={id}
                              className="custom-dropdown-item"
                              style={{ justifyContent: "space-between" }}
                              onClick={(event) => {
                                event.stopPropagation();
                                closeComposerMenus();
                                void updateWorkspaceSettings({
                                  workspaceId: workspace.id,
                                  sessionId: session.id,
                                  approvalMode: workspace.approvalMode,
                                  providerId: normalizedSelection.providerId,
                                  modelId: normalizedSelection.modelId,
                                  effort: id,
                                  fastMode: normalizedSelection.fastMode,
                                  policy: workspace.policy,
                                });
                              }}
                            >
                              <span>{label}</span>
                              {normalizedSelection.effort === id && (
                                <Check size={14} />
                              )}
                            </div>
                          ),
                        )}

                        {composerCapabilities.supportsFastMode && (
                          <>
                            <div
                              style={{
                                height: "1px",
                                background: "#333",
                                margin: "4px 0",
                              }}
                            />
                            <div className="dropdown-section-label">
                              Fast Mode
                            </div>
                            {[
                              { id: false, label: "off" },
                              { id: true, label: "on" },
                            ].map((option) => (
                              <div
                                key={option.label}
                                className="custom-dropdown-item"
                                style={{ justifyContent: "space-between" }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  closeComposerMenus();
                                  void updateWorkspaceSettings({
                                    workspaceId: workspace.id,
                                    sessionId: session.id,
                                    approvalMode: workspace.approvalMode,
                                    providerId: normalizedSelection.providerId,
                                    modelId: normalizedSelection.modelId,
                                    effort: normalizedSelection.effort,
                                    fastMode: option.id,
                                    policy: workspace.policy,
                                  });
                                }}
                              >
                                <span>{option.label}</span>
                                {normalizedSelection.fastMode === option.id && (
                                  <Check size={14} />
                                )}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </>
                  )}
              </div>

              <div
                style={{ width: "1px", height: "12px", background: "#333" }}
              />

              <div
                className="composer-select-wrapper pointer"
                onClick={() =>
                  setCurrentMode(currentMode === "plan" ? "build" : "plan")
                }
                title="Switch between Plan and Build mode"
              >
                {currentMode === "plan" ? (
                  <FileText size={14} />
                ) : (
                  <Zap size={14} />
                )}
                <span>{currentMode === "plan" ? "Plan" : "Build"}</span>
              </div>

              <div
                style={{ width: "1px", height: "12px", background: "#333" }}
              />
            </div>

            <button
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                background:
                  session.status === "streaming"
                    ? "#ef4444"
                    : !sendDisabled && canSubmit
                      ? "#2563eb"
                      : "#333",
                color:
                  session.status === "streaming"
                    ? "#fff"
                    : !sendDisabled && canSubmit
                      ? "#fff"
                      : "#666",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                cursor:
                  session.status === "streaming" || (!sendDisabled && canSubmit)
                    ? "pointer"
                    : "default",
                transition: "background 0.2s, color 0.2s",
              }}
              disabled={
                session.status !== "streaming" && (sendDisabled || !canSubmit)
              }
              onClick={() =>
                session.status === "streaming"
                  ? void abortPrompt(workspace.id, session.id)
                  : !sendDisabled
                    ? void handleSubmit()
                    : undefined
              }
            >
              {session.status === "streaming" ? (
                <Square size={12} fill="currentColor" strokeWidth={0} />
              ) : (
                <ArrowUp size={16} />
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .composer-select-wrapper {
          display: flex;
          align-items: center;
          gap: 6px;
          position: relative;
          padding: 4px 8px;
          margin: 0 -4px;
          border-radius: 6px;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .composer-select-wrapper.pointer:hover {
          cursor: pointer;
        }
        .composer-select-wrapper.pointer:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #eee;
        }
        .custom-dropdown {
          position: absolute;
          bottom: calc(100% + 12px);
          left: -8px;
          background: #1C1C1E;
          border: 1px solid #333;
          border-radius: 12px;
          padding: 8px;
          min-width: 180px;
          z-index: 20;
          box-shadow: 0 12px 30px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .custom-dropdown-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 6px;
          color: #ccc;
          font-size: 0.9rem;
        }
        .custom-dropdown-item:hover {
          cursor: pointer;
          background: #2563eb;
          color: white;
        }
        .dropdown-section-label {
          padding: 4px 12px;
          font-size: 0.7rem;
          font-weight: 700;
          color: #444;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
      `}</style>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ marginTop: "2px" }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ── Turn-based rendering infrastructure ────────────────────────────

interface Turn {
  userMessageId?: string;
  segments: TurnSegment[];
  isCompleted: boolean;
  startTime?: string;
  endTime?: string;
}

function computeTurns(
  timeline: TimelineItem[],
  sessionStatus: ChatSession["status"],
  livePhase: ReturnType<typeof deriveLivePhase>,
): Turn[] {
  const turns: Turn[] = [];
  let currentItems: TimelineItem[] = [];
  let userMessageId: string | undefined;
  let startTime: string | undefined;

  const flushTurn = (
    completed: boolean,
    activeLivePhase?: typeof livePhase,
  ) => {
    if (currentItems.length === 0) return;
    const segments = segmentTurnItems(currentItems, {
      livePhase: activeLivePhase,
    });

    // Find the last assistant-message createdAt as endTime
    const lastAssistant = [...currentItems]
      .reverse()
      .find((item) => item.kind === "assistant-message");
    const endTime =
      lastAssistant?.createdAt ??
      currentItems[currentItems.length - 1].createdAt;

    turns.push({
      userMessageId,
      segments,
      isCompleted: completed,
      startTime,
      endTime,
    });
    currentItems = [];
    userMessageId = undefined;
    startTime = undefined;
  };

  for (const item of timeline) {
    if (item.kind === "user-message") {
      // Start a new turn when we see a user message.
      // If there were items before this user message (assistant preamble), flush them.
      if (currentItems.length > 0) {
        flushTurn(true);
      }
      userMessageId = item.id;
      startTime = item.createdAt;
      currentItems.push(item);
    } else {
      currentItems.push(item);
    }
  }

  // Flush remaining items
  if (currentItems.length > 0) {
    const isStreaming =
      sessionStatus === "streaming" || sessionStatus === "awaiting-approval";
    flushTurn(!isStreaming, isStreaming ? livePhase : null);
  }

  return turns;
}

function TurnRenderer({
  turn,
  workspaceId,
  sessionId,
  onResolveApproval,
  onUndo,
}: {
  turn: Turn;
  workspaceId: string;
  sessionId: string;
  onResolveApproval: (
    workspaceId: string,
    sessionId: string,
    approvalId: string,
    decision: "approved" | "rejected",
  ) => Promise<void>;
  onUndo: (userMessageId: string) => void;
}) {
  const activitySegments = turn.segments.filter((s) => s.type === "activity");
  const toolGroupSegments = activitySegments.filter((segment) =>
    segment.items.some((item) => item.kind === "tool-activity"),
  );
  const hasToolActivity = toolGroupSegments.length > 0;

  // For completed turns with tool activity, extract file changes
  const allToolItems = toolGroupSegments.flatMap((s) =>
    s.items.filter(
      (item): item is ToolActivityItem => item.kind === "tool-activity",
    ),
  );
  const fileChanges =
    turn.isCompleted && allToolItems.length > 0
      ? extractFileChanges(allToolItems)
      : [];

  // Build the inner content (tool groups + interleaved text)
  const innerContent = turn.segments.map((segment, segIndex) => {
    if (segment.type === "activity") {
      if (segment.isLive && segment.livePhase) {
        return (
          <LiveThinkingRow
            key={`seg-${segIndex}`}
            label={segment.livePhase.label}
            detail={segment.livePhase.detail}
          />
        );
      }

      return (
        <ToolActivityGroup
          key={`seg-${segIndex}`}
          segment={{
            phase: segment.activityPhase ?? "other",
            items: segment.items,
            isLive: segment.isLive,
            livePhase: segment.livePhase,
          }}
        />
      );
    }

    // Text (assistant-message) or other items
    return segment.items.map((item) => (
      <TimelineItemView
        key={item.id}
        item={item}
        workspaceId={workspaceId}
        sessionId={sessionId}
        onResolveApproval={onResolveApproval}
      />
    ));
  });

  // For completed turns with tool activity, wrap tool segments in WorkedForBlock
  if (turn.isCompleted && hasToolActivity && turn.startTime && turn.endTime) {
    // Split into: user message, worked-for-block wrapping tools, then final assistant text + files changed
    const userSegments: React.ReactNode[] = [];
    const toolContent: React.ReactNode[] = [];
    const finalTextSegments: React.ReactNode[] = [];

    let passedTools = false;
    for (let i = 0; i < turn.segments.length; i++) {
      const segment = turn.segments[i];
      if (segment.type === "activity") {
        if (segment.isLive && segment.livePhase) {
          toolContent.push(
            <LiveThinkingRow
              key={`seg-${i}`}
              label={segment.livePhase.label}
              detail={segment.livePhase.detail}
            />,
          );
          continue;
        }

        passedTools = true;
        toolContent.push(
          <ToolActivityGroup
            key={`seg-${i}`}
            segment={{
              phase: segment.activityPhase ?? "other",
              items: segment.items,
              isLive: segment.isLive,
              livePhase: segment.livePhase,
            }}
          />,
        );
      } else if (!passedTools && segment.items[0]?.kind === "user-message") {
        userSegments.push(
          ...segment.items.map((item) => (
            <TimelineItemView
              key={item.id}
              item={item}
              workspaceId={workspaceId}
              sessionId={sessionId}
              onResolveApproval={onResolveApproval}
            />
          )),
        );
      } else if (passedTools) {
        // Text after tool activity (or other segments after tools)
        finalTextSegments.push(
          ...segment.items.map((item) => (
            <TimelineItemView
              key={item.id}
              item={item}
              workspaceId={workspaceId}
              sessionId={sessionId}
              onResolveApproval={onResolveApproval}
            />
          )),
        );
      } else {
        // Pre-tool text (inline between user message and tools)
        userSegments.push(
          ...segment.items.map((item) => (
            <TimelineItemView
              key={item.id}
              item={item}
              workspaceId={workspaceId}
              sessionId={sessionId}
              onResolveApproval={onResolveApproval}
            />
          )),
        );
      }
    }

    return (
      <div
        className="turn-block"
        style={{ display: "flex", flexDirection: "column", gap: "14px" }}
      >
        {userSegments}
        {toolContent.length > 0 && (
          <WorkedForBlock startTime={turn.startTime} endTime={turn.endTime}>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {toolContent}
            </div>
          </WorkedForBlock>
        )}
        {finalTextSegments}
        {fileChanges.length > 0 && (
          <FilesChangedBlock
            toolFileChanges={fileChanges}
            onUndo={
              turn.userMessageId ? () => onUndo(turn.userMessageId!) : undefined
            }
          />
        )}
      </div>
    );
  }

  // For streaming/incomplete turns, render inline
  return (
    <div
      className="turn-block"
      style={{ display: "flex", flexDirection: "column", gap: "14px" }}
    >
      {innerContent}
      {fileChanges.length > 0 && (
        <FilesChangedBlock
          toolFileChanges={fileChanges}
          onUndo={
            turn.userMessageId ? () => onUndo(turn.userMessageId!) : undefined
          }
        />
      )}
    </div>
  );
}

function LiveThinkingRow({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  return (
    <div className="chat-row chat-row--assistant animate-slide-up">
      <div className="chat-inline-status chat-inline-status--live">
        <span className="text-shimmer">{label}</span>
        {detail && <span className="chat-inline-status__meta">{detail}</span>}
      </div>
    </div>
  );
}
