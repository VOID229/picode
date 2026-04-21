import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { WorkspaceRecord } from "../../domains/types";
import { useAppStore } from "../../state/useAppStore";

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

export function TerminalPane({ workspace }: TerminalPaneProps) {
  const paneOpen = useAppStore((state) => state.terminalPaneOpen);
  const terminals = useAppStore((state) => state.terminals);
  const createTerminalTab = useAppStore((state) => state.createTerminalTab);
  const closeTerminalTab = useAppStore((state) => state.closeTerminalTab);
  const clearTerminalBuffer = useAppStore((state) => state.clearTerminalBuffer);
  const ensureTerminalSession = useAppStore(
    (state) => state.ensureTerminalSession,
  );
  const restartTerminalTab = useAppStore((state) => state.restartTerminalTab);
  const resizeTerminal = useAppStore((state) => state.resizeTerminal);
  const setActiveTerminalTab = useAppStore(
    (state) => state.setActiveTerminalTab,
  );
  const writeTerminalInput = useAppStore((state) => state.writeTerminalInput);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<TerminalBinding | null>(null);
  const activeBindingIdRef = useRef<string | null>(null);
  const terminalsRef = useRef(terminals);

  terminalsRef.current = terminals;

  const workspaceTerminals = workspace ? terminals[workspace.id] : undefined;
  const activeTerminalTabId = workspaceTerminals?.activeTabId ?? null;
  const activeTerminal = activeTerminalTabId
    ? workspaceTerminals?.tabs[activeTerminalTabId]
    : undefined;

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
      bindingRef.current?.term.dispose();
      bindingRef.current = null;
    };
  }, [writeTerminalInput]);

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
      const terminalTabId =
        activeTerminalTabId ?? (await createTerminalTab(workspace.id));
      if (cancelled) {
        return;
      }

      await ensureTerminalSession(workspace.id, terminalTabId);
      if (cancelled) {
        return;
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled) {
            return;
          }

          const binding = bindingRef.current;
          const container = containerRef.current;
          if (
            !binding ||
            !container ||
            container.clientWidth === 0 ||
            container.clientHeight === 0
          ) {
            return;
          }

          binding.fit.fit();
          void resizeTerminal(
            workspace.id,
            terminalTabId,
            binding.term.cols,
            binding.term.rows,
          );
          binding.term.focus();
          activeBindingIdRef.current = `${workspace.id}:${terminalTabId}`;
        });
      });
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
    activeTerminalTabId,
    createTerminalTab,
    ensureTerminalSession,
    paneOpen,
    resizeTerminal,
    workspace,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const binding = bindingRef.current;
      if (
        !paneOpen ||
        !binding ||
        !binding.workspaceId ||
        !binding.terminalTabId ||
        container.clientWidth === 0 ||
        container.clientHeight === 0
      ) {
        return;
      }

      binding.fit.fit();
      void resizeTerminal(
        binding.workspaceId,
        binding.terminalTabId,
        binding.term.cols,
        binding.term.rows,
      );
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [paneOpen, resizeTerminal]);

  return (
    <section
      className={`terminal-pane ${paneOpen ? "terminal-pane--open" : ""}`}
      aria-hidden={!paneOpen}
    >
      <div className="terminal-pane__meta">
        <div className="terminal-pane__tabs">
          {workspaceTerminals?.tabOrder.map((tabId, index) => {
            const tab = workspaceTerminals.tabs[tabId];
            return (
              <button
                key={tabId}
                className={`terminal-pane__tab ${
                  tabId === activeTerminalTabId
                    ? "terminal-pane__tab--active"
                    : ""
                }`}
                onClick={() => {
                  setActiveTerminalTab(workspace!.id, tabId);
                }}
                type="button"
              >
                <span>
                  {tab.activeCommand?.command || `Shell ${index + 1}`}
                </span>
              </button>
            );
          })}
          <button
            className="terminal-pane__icon-btn"
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
          <span className="terminal-pane__status">
            {activeTerminal?.activeCommand
              ? `Running ${activeTerminal.activeCommand.command}`
              : activeTerminal?.status === "connecting"
                ? "Connecting shell"
                : activeTerminal?.status === "error"
                  ? activeTerminal.error || "Terminal error"
                  : activeTerminal?.status === "exited"
                    ? activeTerminal.error || "Shell exited"
                    : activeTerminal
                      ? "Ready"
                      : workspace
                        ? "No shell"
                        : "Select a workspace"}
          </span>
          <button
            className="terminal-pane__icon-btn"
            disabled={!workspace || !activeTerminalTabId}
            onClick={() => {
              if (workspace && activeTerminalTabId) {
                clearTerminalBuffer(workspace.id, activeTerminalTabId);
              }
            }}
            type="button"
            title="Clear terminal"
          >
            <Trash2 size={14} />
          </button>
          <button
            className="terminal-pane__icon-btn"
            disabled={!workspace || !activeTerminalTabId}
            onClick={() => {
              if (workspace && activeTerminalTabId) {
                void restartTerminalTab(workspace.id, activeTerminalTabId);
              }
            }}
            type="button"
            title="Restart shell"
          >
            <RotateCcw size={14} />
          </button>
          <button
            className="terminal-pane__icon-btn"
            disabled={!workspace || !activeTerminalTabId}
            onClick={() => {
              if (workspace && activeTerminalTabId) {
                void closeTerminalTab(workspace.id, activeTerminalTabId);
              }
            }}
            type="button"
            title="Close terminal tab"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="terminal-pane__viewport">
        <div className="terminal-pane__surface" ref={containerRef} />
      </div>
    </section>
  );
}
