import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
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
}

export function TerminalPane({ workspace }: TerminalPaneProps) {
  const paneOpen = useAppStore((state) => state.terminalPaneOpen);
  const terminals = useAppStore((state) => state.terminals);
  const ensureTerminalSession = useAppStore(
    (state) => state.ensureTerminalSession,
  );
  const writeTerminalInput = useAppStore((state) => state.writeTerminalInput);
  const resizeTerminal = useAppStore((state) => state.resizeTerminal);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<TerminalBinding | null>(null);
  const activeWorkspaceIdRef = useRef<string | null>(workspace?.id ?? null);
  const inputReadyWorkspaceIdRef = useRef<string | null>(null);
  const terminalsRef = useRef(terminals);

  activeWorkspaceIdRef.current = workspace?.id ?? null;
  terminalsRef.current = terminals;

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
    };

    const initialWorkspaceId = activeWorkspaceIdRef.current;
    const initialBuffer = initialWorkspaceId
      ? (terminalsRef.current[initialWorkspaceId]?.buffer ?? "")
      : "";
    if (initialBuffer) {
      term.write(initialBuffer);
      bindingRef.current.appliedLength = initialBuffer.length;
      bindingRef.current.workspaceId = initialWorkspaceId;
    }

    term.onData((data) => {
      const activeWorkspaceId = activeWorkspaceIdRef.current;
      if (
        !activeWorkspaceId ||
        inputReadyWorkspaceIdRef.current !== activeWorkspaceId
      ) {
        return;
      }

      void writeTerminalInput(activeWorkspaceId, data);
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

    const workspaceId = workspace?.id ?? null;
    const buffer = workspaceId ? (terminals[workspaceId]?.buffer ?? "") : "";

    if (binding.workspaceId !== workspaceId) {
      binding.term.reset();
      if (buffer) {
        binding.term.write(buffer);
      }
      binding.appliedLength = buffer.length;
      binding.workspaceId = workspaceId;
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
  }, [terminals, workspace]);

  useEffect(() => {
    if (!paneOpen || !workspace) {
      inputReadyWorkspaceIdRef.current = null;
      return;
    }

    let cancelled = false;
    inputReadyWorkspaceIdRef.current = null;

    const prepareTerminal = async () => {
      await ensureTerminalSession(workspace.id);
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
            binding.term.cols,
            binding.term.rows,
          );
          binding.term.focus();
          inputReadyWorkspaceIdRef.current = workspace.id;
        });
      });
    };

    void prepareTerminal().catch(() => {
      if (!cancelled) {
        inputReadyWorkspaceIdRef.current = null;
      }
    });

    return () => {
      cancelled = true;
      inputReadyWorkspaceIdRef.current = null;
    };
  }, [ensureTerminalSession, paneOpen, resizeTerminal, workspace]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const binding = bindingRef.current;
      const activeWorkspaceId = activeWorkspaceIdRef.current;
      if (
        !paneOpen ||
        !binding ||
        !activeWorkspaceId ||
        container.clientWidth === 0 ||
        container.clientHeight === 0
      ) {
        return;
      }

      binding.fit.fit();
      if (inputReadyWorkspaceIdRef.current === activeWorkspaceId) {
        void resizeTerminal(
          activeWorkspaceId,
          binding.term.cols,
          binding.term.rows,
        );
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [paneOpen, resizeTerminal]);

  const activeTerminal = workspace ? terminals[workspace.id] : undefined;

  return (
    <section
      className={`terminal-pane ${paneOpen ? "terminal-pane--open" : ""}`}
      aria-hidden={!paneOpen}
    >
      <div className="terminal-pane__meta">
        <span className="terminal-pane__title">
          {workspace ? workspace.name : "Terminal"}
        </span>
        <span className="terminal-pane__status">
          {activeTerminal?.activeCommand
            ? `Running ${activeTerminal.activeCommand.command}`
            : activeTerminal?.status === "ready"
              ? "Interactive shell"
              : activeTerminal?.status === "connecting"
                ? "Connecting shell"
                : activeTerminal?.status === "error"
                  ? activeTerminal.error || "Terminal error"
                  : activeTerminal?.status === "exited"
                    ? activeTerminal.error || "Shell exited"
                    : "Ready"}
        </span>
      </div>

      <div className="terminal-pane__viewport">
        <div className="terminal-pane__surface" ref={containerRef} />
      </div>
    </section>
  );
}
