const APPROVAL_TITLE = "__PICODE_APPROVAL__";

export function approvalExtensionSource(policyFilePath: string) {
  return `import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isToolCallEventType,
  type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

const APPROVAL_TITLE = ${JSON.stringify(APPROVAL_TITLE)};
const POLICY_FILE = ${JSON.stringify(policyFilePath)};

function loadPolicy(cwd: string) {
  if (!existsSync(POLICY_FILE)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(POLICY_FILE, "utf8"));
    const workspaces = raw?.workspaces ?? {};
    return Object.values(workspaces).find((entry: any) => {
      return typeof entry?.cwd === "string" && resolve(entry.cwd) === resolve(cwd);
    }) as any;
  } catch {
    return undefined;
  }
}

function matchesAllowedCommand(command: string, allowedCommands: string[]) {
  const normalized = command.trim();
  return allowedCommands.some((allowed) => {
    const candidate = allowed.trim();
    return candidate.length > 0 && (normalized === candidate || normalized.startsWith(candidate + " "));
  });
}

function pathAllowed(rawPath: string | undefined, cwd: string, allowedPaths: string[]) {
  if (!rawPath) return false;
  const absolute = resolve(cwd, rawPath);
  if (allowedPaths.length === 0) return false;
  return allowedPaths.some((allowed) => {
    const base = resolve(allowed);
    return absolute === base || absolute.startsWith(base + "/");
  });
}

function commandUsesNetwork(command: string) {
  return /\\b(curl|wget|nc|ncat|ssh|scp|rsync|git\\s+clone|git\\s+fetch|git\\s+pull|bun\\s+add|pip\\s+install|cargo\\s+add|brew\\s+install)\\b/i.test(command);
}

function dangerousBash(command: string, networkEnabled: boolean) {
  if (!networkEnabled && commandUsesNetwork(command)) return true;
  return [
    /\\brm\\b/i,
    /\\bmv\\b/i,
    /\\bcp\\b/i,
    /\\bsudo\\b/i,
    /\\bchmod\\b/i,
    /\\bchown\\b/i,
    /git\\s+reset\\s+--hard/i,
    /git\\s+checkout\\s+--/i,
    /git\\s+clean\\b/i,
    /sed\\s+-i/i,
    /perl\\s+-pi/i,
    /python\\s+-c/i,
    /node\\s+-e/i,
    /bun\\s+-e/i,
  ].some((pattern) => pattern.test(command));
}

async function requestApproval(ctx: any, payload: Record<string, unknown>) {
  const approved = await ctx.ui.confirm(APPROVAL_TITLE, JSON.stringify(payload));
  if (!approved) {
    return { block: true, reason: "Blocked by user" };
  }
  return undefined;
}

export default function approvalGate(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const workspace = loadPolicy(ctx.cwd);
    const approvalMode = workspace?.approvalMode ?? "supervised";
    const policy = workspace?.policy ?? {
      allowedPaths: [],
      allowedCommands: [],
      envPassthrough: [],
      networkEnabled: false,
    };

    if (approvalMode === "full-access") {
      return undefined;
    }

    if (
      isToolCallEventType("read", event) ||
      isToolCallEventType("grep", event) ||
      isToolCallEventType("find", event) ||
      isToolCallEventType("ls", event)
    ) {
      return undefined;
    }

    if (isToolCallEventType("write", event)) {
      const targetPath = event.input.path;
      const insideAllowedPath = pathAllowed(targetPath, ctx.cwd, policy.allowedPaths);
      if (approvalMode === "auto-accept-edits" && insideAllowedPath) {
        return undefined;
      }
      return requestApproval(ctx, {
        risk: insideAllowedPath ? "medium" : "high",
        title: "Approve file write",
        reason: insideAllowedPath
          ? "Pi wants to write a file in the workspace."
          : "Pi wants to write a file outside the allowed paths.",
        path: resolve(ctx.cwd, targetPath),
      });
    }

    if (isToolCallEventType("edit", event)) {
      const targetPath = event.input.path;
      const insideAllowedPath = pathAllowed(targetPath, ctx.cwd, policy.allowedPaths);
      if (approvalMode === "auto-accept-edits" && insideAllowedPath) {
        return undefined;
      }
      return requestApproval(ctx, {
        risk: insideAllowedPath ? "medium" : "high",
        title: "Approve file edit",
        reason: insideAllowedPath
          ? "Pi wants to edit a file in the workspace."
          : "Pi wants to edit a file outside the allowed paths.",
        path: resolve(ctx.cwd, targetPath),
      });
    }

    if (isToolCallEventType("bash", event)) {
      const command = event.input.command;
      const whitelisted = matchesAllowedCommand(command, policy.allowedCommands);
      const dangerous = dangerousBash(command, policy.networkEnabled);
      if (!dangerous && (whitelisted || approvalMode !== "supervised")) {
        return undefined;
      }
      if (!dangerous && approvalMode === "supervised") {
        return undefined;
      }
      return requestApproval(ctx, {
        risk: dangerous ? "high" : "medium",
        title: "Approve bash command",
        reason: dangerous
          ? "Pi wants to run a potentially mutating or networked shell command."
          : "Pi wants to run a shell command outside the allowed command list.",
        command,
      });
    }

    return undefined;
  });
}
`;
}

export { APPROVAL_TITLE };
