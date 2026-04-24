import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceRecord } from "../../domains/types";
import { useAppStore } from "../../state/useAppStore";
import { ContextMenu } from "../layout/ContextMenu";
import { PromptModal } from "../layout/PromptModal";

interface TerminalPaneProps {
  workspace: WorkspaceRecord | null;
}

interface TerminalBinding {
  fit: FitAddon;
  term: Terminal;
  appliedLength: number;
  workspaceId: string | null;
  terminalTabId: string | null;
}

function getTerminalTabLabel(title: string | undefined, fallbackIndex: number) {
  const trimmed = title?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : `terminal ${fallbackIndex + 1}`;
}

export function TerminalPane({ workspace }: TerminalPaneProps) {
  const paneOpen = useAppStore((state) => state.terminalPaneOpen);
  const terminals = useAppStore((state) => state.terminals);
  const closeTerminalTab = useAppStore((state) => state.closeTerminalTab);
  const createTerminalTab = useAppStore((state) => state.createTerminalTab);
  const ensureTerminalSession = useAppStore(
    (state) => state.ensureTerminalSession,
  );
  const renameTerminalTab = useAppStore((state) => state.renameTerminalTab);
  const resizeTerminal = useAppStore((state) => state.resizeTerminal);
  const setActiveTerminalTab = useAppStore(
    (state) => state.setActiveTerminalTab,
  );
  const setTerminalPaneOpen = useAppStore((state) => state.setTerminalPaneOpen);
  const writeTerminalInput = useAppStore((state) => state.writeTerminalInput);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<TerminalBinding | null>(null);
  const activeBindingIdRef = useRef<string | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const lastResizeKeyRef = useRef<string | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);

  const workspaceTerminals = workspace ? terminals[workspace.id] : undefined;
  const activeTerminalTabId = workspaceTerminals?.activeTabId ?? null;
  const activeTerminal = activeTerminalTabId
    ? workspaceTerminals?.tabs[activeTerminalTabId]
    : undefined;
  const activeTerminalStatus = activeTerminal?.status;
  const renamingTabIndex = renamingTabId
    ? (workspaceTerminals?.tabOrder.findIndex(
        (tabId) => tabId === renamingTabId,
      ) ?? -1)
    : -1;
  const renamingTab = renamingTabId
    ? workspaceTerminals?.tabs[renamingTabId]
    : undefined;

  const scheduleTerminalLayout = useCallback(
    (options?: { focus?: boolean }) => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }

      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;

        const binding = bindingRef.current;
        const container = containerRef.current;
        if (
          !paneOpen ||
          !binding ||
          !container ||
          !binding.workspaceId ||
          !binding.terminalTabId
        ) {
          return;
        }

        if (container.clientWidth === 0 || container.clientHeight === 0) {
          return;
        }

        binding.fit.fit();

        const resizeKey = `${binding.workspaceId}:${binding.terminalTabId}:${binding.term.cols}:${binding.term.rows}`;
        if (lastResizeKeyRef.current !== resizeKey) {
          lastResizeKeyRef.current = resizeKey;
          void resizeTerminal(
            binding.workspaceId,
            binding.terminalTabId,
            binding.term.cols,
            binding.term.rows,
          );
        }

        if (options?.focus) {
          binding.term.focus();
        }

        activeBindingIdRef.current = `${binding.workspaceId}:${binding.terminalTabId}`;
      });
    },
    [paneOpen, resizeTerminal],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bindingRef.current) {
      return;
    }

    const fit = new FitAddon();
    const term = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"SF Mono", "JetBrains Mono", "Menlo", "Monaco", monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: "#121212",
        foreground: "#e8e8e5",
        cursor: "#d7d7d2",
        black: "#0f0f0f",
        red: "#d87c6a",
        green: "#87a57b",
        yellow: "#c9aa71",
        blue: "#7a8aa6",
        magenta: "#9b87ad",
        cyan: "#7ba6a1",
        white: "#d5d3cf",
        brightBlack: "#5a5a58",
        brightRed: "#e19b8d",
        brightGreen: "#a8c09c",
        brightYellow: "#d8c08d",
        brightBlue: "#97a7c2",
        brightMagenta: "#b39fc4",
        brightCyan: "#9bbeb8",
        brightWhite: "#f2f0eb",
      },
    });

    term.loadAddon(fit);
    term.open(container);

    bindingRef.current = {
      fit,
      term,
      appliedLength: 0,
      workspaceId: null,
      terminalTabId: null,
    };

    term.onData((data) => {
      const binding = bindingRef.current;
      const bindingId =
        binding?.workspaceId && binding?.terminalTabId
          ? `${binding.workspaceId}:${binding.terminalTabId}`
          : null;
      if (!binding?.workspaceId || !binding?.terminalTabId) {
        return;
      }
      if (activeBindingIdRef.current !== bindingId) {
        return;
      }

      void writeTerminalInput(binding.workspaceId, binding.terminalTabId, data);
    });

    return () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      bindingRef.current?.term.dispose();
      bindingRef.current = null;
    };
  }, [writeTerminalInput]);

  useEffect(() => {
    lastResizeKeyRef.current = null;
  }, [activeTerminalTabId, paneOpen, workspace?.id]);

  useEffect(() => {
    const binding = bindingRef.current;
    if (!binding) {
      return;
    }

    const buffer = activeTerminal?.buffer ?? "";

    if (
      binding.workspaceId !== workspace?.id ||
      binding.terminalTabId !== activeTerminalTabId
    ) {
      binding.term.reset();
      if (buffer) {
        binding.term.write(buffer);
      }
      binding.appliedLength = buffer.length;
      binding.workspaceId = workspace?.id ?? null;
      binding.terminalTabId = activeTerminalTabId;
      return;
    }

    if (buffer.length < binding.appliedLength) {
      binding.term.reset();
      if (buffer) {
        binding.term.write(buffer);
      }
      binding.appliedLength = buffer.length;
      return;
    }

    if (buffer.length > binding.appliedLength) {
      binding.term.write(buffer.slice(binding.appliedLength));
      binding.appliedLength = buffer.length;
    }
  }, [activeTerminal, activeTerminalTabId, workspace?.id]);

  useEffect(() => {
    if (!paneOpen || !workspace) {
      activeBindingIdRef.current = null;
      return;
    }

    let cancelled = false;

    const prepareTerminal = async () => {
      let terminalTabId = activeTerminalTabId;

      if (!terminalTabId) {
        terminalTabId = await createTerminalTab(workspace.id);
      } else if (
        !activeTerminalStatus ||
        activeTerminalStatus === "idle" ||
        activeTerminalStatus === "error" ||
        activeTerminalStatus === "exited"
      ) {
        await ensureTerminalSession(workspace.id, terminalTabId);
      }

      if (cancelled) {
        return;
      }

      scheduleTerminalLayout({ focus: true });
    };

    void prepareTerminal().catch(() => {
      if (!cancelled) {
        activeBindingIdRef.current = null;
      }
    });

    return () => {
      cancelled = true;
      activeBindingIdRef.current = null;
    };
  }, [
    activeTerminalStatus,
    activeTerminalTabId,
    createTerminalTab,
    ensureTerminalSession,
    paneOpen,
    scheduleTerminalLayout,
    workspace,
  ]);

  useEffect(() => {
    const handleRenameShortcut = (event: KeyboardEvent) => {
      if (
        !paneOpen ||
        !workspace ||
        !activeTerminalTabId ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "r"
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setRenamingTabId(activeTerminalTabId);
    };

    window.addEventListener("keydown", handleRenameShortcut, true);
    return () =>
      window.removeEventListener("keydown", handleRenameShortcut, true);
  }, [activeTerminalTabId, paneOpen, workspace]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      scheduleTerminalLayout();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [scheduleTerminalLayout]);

  return (
    <section
      className={`terminal-pane ${paneOpen ? "terminal-pane--open" : ""}`}
      aria-hidden={!paneOpen}
    >
      <div className="terminal-pane__meta">
        <div className="terminal-pane__tabs-wrap">
          <div
            className="terminal-pane__tabs"
            role="tablist"
            aria-label="Terminal tabs"
          >
            {workspaceTerminals?.tabOrder.map((tabId, index) => {
              const tab = workspaceTerminals.tabs[tabId];
              const tabLabel = getTerminalTabLabel(tab.title, index);

              return (
                <div
                  key={tabId}
                  className={`terminal-pane__tab ${
                    tabId === activeTerminalTabId
                      ? "terminal-pane__tab--active"
                      : ""
                  }`}
                >
                  <button
                    className="terminal-pane__tab-trigger"
                    onClick={() => {
                      if (workspace) {
                        setActiveTerminalTab(workspace.id, tabId);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setTabContextMenu({
                        tabId,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                    type="button"
                    role="tab"
                    aria-selected={tabId === activeTerminalTabId}
                  >
                    <span className="terminal-pane__tab-label">{tabLabel}</span>
                  </button>
                  <button
                    className="terminal-pane__tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (workspace) {
                        void closeTerminalTab(workspace.id, tabId);
                      }
                    }}
                    type="button"
                    title="Close terminal tab"
                    aria-label={`Close ${tabLabel}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            className="terminal-pane__icon-btn terminal-pane__icon-btn--tab-add"
            onClick={() => {
              if (workspace) {
                void createTerminalTab(workspace.id);
              }
            }}
            type="button"
            title="New terminal tab"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="terminal-pane__actions">
          {activeTerminal?.status !== "ready" && (
            <span className="terminal-pane__status">
              {activeTerminal?.status === "connecting"
                ? "Connecting shell"
                : activeTerminal?.status === "error"
                  ? activeTerminal.error || "Terminal error"
                  : activeTerminal?.status === "exited"
                    ? activeTerminal.error || "Shell exited"
                    : workspace
                      ? "No shell"
                      : "Select a workspace"}
            </span>
          )}
          <button
            className="terminal-pane__icon-btn"
            onClick={() => {
              setTerminalPaneOpen(false);
            }}
            type="button"
            title="Hide terminal pane"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="terminal-pane__viewport">
        <div className="terminal-pane__surface" ref={containerRef} />
      </div>

      {tabContextMenu && (
        <ContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          items={[
            {
              label: "Rename terminal",
              onClick: () => {
                setRenamingTabId(tabContextMenu.tabId);
              },
            },
          ]}
          onClose={() => setTabContextMenu(null)}
        />
      )}

      {workspace && renamingTabId && (
        <PromptModal
          title="Rename terminal"
          initialValue={getTerminalTabLabel(
            renamingTab?.title,
            Math.max(renamingTabIndex, 0),
          )}
          onConfirm={(value) => {
            renameTerminalTab(workspace.id, renamingTabId, value);
            setRenamingTabId(null);
          }}
          onCancel={() => setRenamingTabId(null)}
        />
      )}
    </section>
  );
}
