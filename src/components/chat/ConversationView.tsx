import { ArrowUp, Shield, Lock, Bot, FileText, Zap, Check } from "lucide-react";
import { useMemo, useState, useRef, useEffect } from "react";
import type { ChatSession, WorkspaceRecord } from "../../domains/types";
import { useAppStore } from "../../state/useAppStore";
import { TimelineItemView } from "./TimelineItemView";

interface ConversationViewProps {
  workspace: WorkspaceRecord | null;
  session: ChatSession | null;
}

export function ConversationView({
  workspace,
  session,
}: ConversationViewProps) {
  const [draft, setDraft] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [approvalDropdownOpen, setApprovalDropdownOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  
  const state = useAppStore((store) => store.state);
  const currentMode = useAppStore((store) => store.currentMode);
  const setCurrentMode = useAppStore((store) => store.setCurrentMode);
  const sendPrompt = useAppStore((state) => state.sendPrompt);
  const resolveApproval = useAppStore((state) => state.resolveApproval);
  const updateWorkspaceSettings = useAppStore((store) => store.updateWorkspaceSettings);

  const handleSubmit = async () => {
    const value = draft.trim();
    if (!workspace || !session || !value) {
      return;
    }
    await sendPrompt(workspace.id, session.id, value);
    setDraft("");
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [draft]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [session?.timeline.length, session?.status]);

  if (!workspace || !session) {
    return (
      <div className="empty-state" style={{ color: '#555' }}>
        Send a message to start the conversation.
      </div>
    );
  }

  const hasUserMessage = session.timeline.some((item) => item.kind === "user-message");
  const isEmptySpace = !hasUserMessage;

  const activeProvider = state?.providers.find((p) => p.id === workspace.providerId);
  const activeModel = activeProvider?.models.find((m) => m.id === workspace.modelId);

  return (
    <div className="conversation-view" style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: 'var(--bg)' }}>
      {isEmptySpace ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
          Send a message to start the conversation.
        </div>
      ) : (
        <div className="timeline" ref={timelineRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: '24px' }}>
          <div className="message-outer" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            {session.timeline.map((item) => (
              <TimelineItemView
                key={item.id}
                item={item}
                workspaceId={workspace.id}
                sessionId={session.id}
                onResolveApproval={resolveApproval}
              />
            ))}
          </div>
        </div>
      )}

      <div style={{ position: 'relative', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
        <div 
          style={{
            background: '#18181A',
            border: `1px solid ${isFocused ? '#2563eb' : '#333'}`,
            borderRadius: '12px',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            transition: 'border-color 0.2s',
            boxShadow: isFocused ? '0 0 0 1px #2563eb' : 'none'
          }}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask for follow-up changes or attach images"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            rows={1}
            style={{
              background: 'transparent',
              border: 'none',
              resize: 'none',
              color: '#eaeaea',
              fontSize: '0.95rem',
              outline: 'none',
              maxHeight: '200px'
            }}
          />
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#666', fontSize: '0.8rem' }}>
              
              <div className="composer-select-wrapper pointer" onClick={() => setModelDropdownOpen(!modelDropdownOpen)}>
                <Bot size={14} />
                <span style={{ paddingRight: '4px' }}>{activeModel?.label || "Select Model"}</span>
                <ChevronIcon />
                {modelDropdownOpen && (
                  <>
                    <div 
                      style={{ position: 'fixed', inset: 0, zIndex: 30 }} 
                      onClick={(e) => { e.stopPropagation(); setModelDropdownOpen(false); }} 
                    />
                    <div className="custom-dropdown">
                      {activeProvider?.models.map(m => (
                        <div 
                          key={m.id} 
                          className="custom-dropdown-item" 
                          onClick={(e) => {
                            e.stopPropagation();
                            setModelDropdownOpen(false);
                            void updateWorkspaceSettings({
                              workspaceId: workspace.id,
                              approvalMode: workspace.approvalMode,
                              providerId: workspace.providerId,
                              modelId: m.id,
                              policy: workspace.policy,
                            });
                          }}
                        >
                          <div style={{ width: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {workspace.modelId === m.id && <Check size={14} />}
                          </div>
                          <span>{m.label}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div style={{ width: '1px', height: '12px', background: '#333' }} />

              <div className="composer-select-wrapper pointer">
                <span style={{ paddingRight: '4px' }}>High</span>
                <ChevronIcon />
              </div>

              <div style={{ width: '1px', height: '12px', background: '#333' }} />

              <div 
                className="composer-select-wrapper pointer" 
                onClick={() => setCurrentMode(currentMode === "plan" ? "build" : "plan")}
                title="Switch between Plan and Build mode"
              >
                {currentMode === "plan" ? <FileText size={14} /> : <Zap size={14} />}
                <span>{currentMode === "plan" ? "Plan" : "Build"}</span>
              </div>

              <div style={{ width: '1px', height: '12px', background: '#333' }} />

              <div className="composer-select-wrapper pointer" onClick={() => setApprovalDropdownOpen(!approvalDropdownOpen)}>
                <Lock size={14} />
                <span style={{ paddingRight: '4px' }}>{workspace.approvalMode === 'ask-first' ? 'Ask first' : 'Full access'}</span>
                <ChevronIcon />
                
                {approvalDropdownOpen && (
                  <>
                    <div 
                      style={{ position: 'fixed', inset: 0, zIndex: 30 }} 
                      onClick={(e) => { e.stopPropagation(); setApprovalDropdownOpen(false); }} 
                    />
                    <div className="custom-dropdown">
                      {[
                        { id: 'ask-first', label: 'Ask first' },
                        { id: 'full-access', label: 'Full access' }
                      ].map(m => (
                        <div 
                          key={m.id} 
                          className="custom-dropdown-item" 
                          onClick={(e) => {
                            e.stopPropagation();
                            setApprovalDropdownOpen(false);
                            void updateWorkspaceSettings({
                              workspaceId: workspace.id,
                              approvalMode: m.id as any,
                              providerId: workspace.providerId,
                              modelId: workspace.modelId,
                              policy: workspace.policy,
                            });
                          }}
                        >
                          <div style={{ width: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {workspace.approvalMode === m.id && <Check size={14} />}
                          </div>
                          <span>{m.label}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

            </div>

            <button
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: draft.trim() ? '#2563eb' : '#333',
                color: draft.trim() ? '#fff' : '#666',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                cursor: draft.trim() ? 'pointer' : 'default',
                transition: 'background 0.2s, color 0.2s'
              }}
              disabled={!draft.trim() || session.status === "streaming"}
              onClick={() => void handleSubmit()}
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
        .composer-select-wrapper.pointer {
          cursor: pointer;
        }
        .composer-select-wrapper.pointer:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #eee;
        }
        .composer-select {
          appearance: none;
          background: transparent;
          border: none;
          color: inherit;
          font-size: inherit;
          cursor: pointer;
          outline: none;
          padding-right: 4px;
        }
        .composer-select option {
          background: #18181A;
          color: #fff;
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
          z-index: 40;
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
          cursor: pointer;
          color: #ccc;
          font-size: 0.9rem;
        }
        .custom-dropdown-item:hover {
          background: #2563eb;
          color: white;
        }
      `}</style>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '2px' }}>
      <path d="m6 9 6 6 6-6"/>
    </svg>
  );
}
