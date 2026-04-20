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
}

export function TerminalPane({ workspace }: TerminalPaneProps) {
  const paneOpen = useAppStore((state) => state.terminalPaneOpen);
  const terminals = useAppStore((state) => state.terminals);
  const ensureTerminalSession = useAppStore(
    (state) => state.ensureTerminalSession,
  );
  const writeTerminalInput = useAppStore((state) => state.writeTerminalInput);
  const resizeTerminal = useAppStore((state) => state.resizeTerminal);
  const allWorkspaces = useAppStore((state) => state.state?.workspaces ?? []);

  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const bindingsRef = useRef<Map<string, TerminalBinding>>(new Map());
  const resizeObserversRef = useRef<Map<string, ResizeObserver>>(new Map());

  useEffect(() => {
    if (paneOpen && workspace) {
      void ensureTerminalSession(workspace.id);
    }
  }, [ensureTerminalSession, paneOpen, workspace]);

  useEffect(() => {
    for (const item of allWorkspaces) {
      const container = containerRefs.current[item.id];
      if (!container || bindingsRef.current.has(item.id)) {
        continue;
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
      fit.fit();

      bindingsRef.current.set(item.id, {
        fit,
        term,
        appliedLength: 0,
      });

      term.onData((data) => {
        void writeTerminalInput(item.id, data);
      });

      void resizeTerminal(item.id, term.cols, term.rows);

      const observer = new ResizeObserver(() => {
        const binding = bindingsRef.current.get(item.id);
        if (!binding || !paneOpen) {
          return;
        }
        binding.fit.fit();
        void resizeTerminal(item.id, binding.term.cols, binding.term.rows);
      });

      observer.observe(container);
      resizeObserversRef.current.set(item.id, observer);
    }
  }, [allWorkspaces, paneOpen, resizeTerminal, writeTerminalInput]);

  useEffect(
    () => () => {
      for (const observer of resizeObserversRef.current.values()) {
        observer.disconnect();
      }
      resizeObserversRef.current.clear();
      for (const binding of bindingsRef.current.values()) {
        binding.term.dispose();
      }
      bindingsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    for (const [workspaceId, binding] of bindingsRef.current.entries()) {
      const buffer = terminals[workspaceId]?.buffer ?? "";
      if (!buffer) {
        continue;
      }

      if (binding.appliedLength === 0) {
        binding.term.reset();
        binding.term.write(buffer);
        binding.appliedLength = buffer.length;
        continue;
      }

      if (buffer.length < binding.appliedLength) {
        binding.term.reset();
        binding.term.write(buffer);
        binding.appliedLength = buffer.length;
        continue;
      }

      if (buffer.length > binding.appliedLength) {
        binding.term.write(buffer.slice(binding.appliedLength));
        binding.appliedLength = buffer.length;
      }
    }
  }, [terminals]);

  useEffect(() => {
    if (!paneOpen || !workspace) {
      return;
    }

    const binding = bindingsRef.current.get(workspace.id);
    if (!binding) {
      return;
    }

    binding.fit.fit();
    void resizeTerminal(workspace.id, binding.term.cols, binding.term.rows);
    binding.term.focus();
  }, [paneOpen, resizeTerminal, workspace]);

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
        {allWorkspaces.map((item) => (
          <div
            key={item.id}
            className={`terminal-pane__surface ${
              workspace?.id === item.id ? "terminal-pane__surface--active" : ""
            }`}
            ref={(node) => {
              containerRefs.current[item.id] = node;
            }}
          />
        ))}
      </div>
    </section>
  );
}
