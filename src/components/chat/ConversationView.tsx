import {
  ArrowUp,
  Bot,
  Check,
  FileText,
  LoaderCircle,
  Search,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatSession, WorkspaceRecord } from "../../domains/types";
import { useAppStore } from "../../state/useAppStore";
import { TimelineItemView } from "./TimelineItemView";
import {
  deriveLivePhase,
  resolveAssistantLabel,
  resolveComposerCapabilities,
  resolveSessionSelection,
  shortenAssistantLabel,
  type LivePhase,
} from "./chatRuntime";

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
  const currentMode = useAppStore((store) => store.currentMode);
  const setCurrentMode = useAppStore((store) => store.setCurrentMode);
  const setComposerDraft = useAppStore((store) => store.setComposerDraft);
  const clearComposerDraft = useAppStore((store) => store.clearComposerDraft);
  const sendPrompt = useAppStore((state) => state.sendPrompt);
  const abortPrompt = useAppStore((state) => state.abortPrompt);
  const resolveApproval = useAppStore((state) => state.resolveApproval);
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

  const handleSubmit = async () => {
    const value = sessionDraft.trim();
    if (!workspace || !session || !value) {
      return;
    }

    closeComposerMenus();
    clearComposerDraft(session.id);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      await sendPrompt(workspace.id, session.id, value, currentMode);
    } catch (error) {
      setComposerDraft(session.id, value);
      throw error;
    }
  };

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
  const assistantLabel = resolveAssistantLabel({
    session,
    workspace,
    workspaceCatalog: workspaceProviders,
    defaultProviders: stateProviders,
  });
  const assistantChromeLabel = shortenAssistantLabel(assistantLabel);
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
            style={{ display: "flex", flexDirection: "column", gap: "32px" }}
          >
            {session.timeline.map((item) => (
              <TimelineItemView
                key={item.id}
                item={item}
                workspaceId={workspace.id}
                sessionId={session.id}
                assistantLabel={assistantChromeLabel}
                onResolveApproval={resolveApproval}
              />
            ))}
            {livePhase && (
              <LivePhaseIndicator
                assistantLabel={assistantChromeLabel}
                phase={livePhase}
              />
            )}
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
            placeholder="Ask for follow-up changes or attach images"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!sendDisabled) {
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
                    : !sendDisabled && sessionDraft.trim()
                      ? "#2563eb"
                      : "#333",
                color:
                  session.status === "streaming"
                    ? "#fff"
                    : !sendDisabled && sessionDraft.trim()
                      ? "#fff"
                      : "#666",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                cursor:
                  session.status === "streaming" ||
                  (!sendDisabled && Boolean(sessionDraft.trim()))
                    ? "pointer"
                    : "default",
                transition: "background 0.2s, color 0.2s",
              }}
              disabled={
                session.status !== "streaming" &&
                (sendDisabled || !sessionDraft.trim())
              }
              onClick={() =>
                session.status === "streaming"
                  ? void abortPrompt(workspace.id, session.id)
                  : !sendDisabled
                    ? void handleSubmit()
                    : undefined
              }
            >
              <ArrowUp size={16} />
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

function LivePhaseIndicator({
  assistantLabel,
  phase,
}: {
  assistantLabel: string;
  phase: LivePhase;
}) {
  return (
    <div className="chat-row chat-row--assistant">
      <div className={`chat-live-phase chat-live-phase--${phase.phase}`}>
        <div className="chat-speaker-label">{assistantLabel}</div>
        <div className="chat-inline-status chat-inline-status--live">
          <span className="chat-live-phase__icon">
            <LivePhaseIcon phase={phase} />
          </span>
          <span className="chat-live-phase__text" data-text={phase.label}>
            {phase.label}
          </span>
          {phase.detail && (
            <span className="chat-inline-status__meta">{phase.detail}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function LivePhaseIcon({ phase }: { phase: LivePhase }) {
  switch (phase.phase) {
    case "reading-files":
      return <Search size={14} />;
    case "listing-directory":
      return <Wrench size={14} />;
    case "writing-files":
      return <FileText size={14} />;
    case "verifying":
      return <Check size={14} />;
    case "thinking":
    default:
      return <LoaderCircle size={14} className="chat-inline-status__spin" />;
  }
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
