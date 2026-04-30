export function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function isPrimaryShortcut(event: KeyboardEvent) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

export function isThreadShortcut(event: KeyboardEvent) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

export function isTerminalShortcut(event: KeyboardEvent) {
  return isMacPlatform() ? event.ctrlKey : event.altKey;
}

export type ShortcutId =
  | "commandPalette"
  | "settings"
  | "addProject"
  | "openWorkspace"
  | "toggleTerminalPane"
  | "newTerminalTab"
  | "closeTerminalTab"
  | "renameTerminalTab"
  | "switchThread"
  | "switchTerminalTab";

export interface ShortcutDefinition {
  id: ShortcutId;
  label: string;
  description: string;
  defaultBinding: string;
}

export type ShortcutOverrides = Partial<Record<ShortcutId, string | null>>;

export const shortcutDefinitions: ShortcutDefinition[] = [
  {
    id: "commandPalette",
    label: "Command palette",
    description: "Open actions and recent threads.",
    defaultBinding: "Meta+K",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Open picode settings.",
    defaultBinding: "Meta+,",
  },
  {
    id: "addProject",
    label: "Add project",
    description: "Open the project picker.",
    defaultBinding: "Meta+N",
  },
  {
    id: "openWorkspace",
    label: "Open project",
    description: "Open the active project in the selected target.",
    defaultBinding: "Meta+O",
  },
  {
    id: "toggleTerminalPane",
    label: "Toggle terminal pane",
    description: "Open or close the terminal pane.",
    defaultBinding: "Meta+J",
  },
  {
    id: "newTerminalTab",
    label: "New terminal tab",
    description: "Create a terminal tab when the terminal pane is open.",
    defaultBinding: "Meta+T",
  },
  {
    id: "closeTerminalTab",
    label: "Close terminal tab",
    description: "Close the active terminal tab.",
    defaultBinding: "Meta+W",
  },
  {
    id: "renameTerminalTab",
    label: "Rename terminal tab",
    description: "Rename the active terminal tab.",
    defaultBinding: "Meta+R",
  },
  {
    id: "switchThread",
    label: "Switch thread",
    description: "Switch to threads 1-9.",
    defaultBinding: "Meta+Digit",
  },
  {
    id: "switchTerminalTab",
    label: "Switch terminal tab",
    description: "Switch to terminal tabs 1-9.",
    defaultBinding: "Control+Digit",
  },
];

export function getShortcutBinding(
  shortcuts: ShortcutOverrides | undefined,
  id: ShortcutId,
) {
  if (shortcuts && Object.prototype.hasOwnProperty.call(shortcuts, id)) {
    return shortcuts[id] ?? null;
  }

  return (
    shortcutDefinitions.find((definition) => definition.id === id)
      ?.defaultBinding ?? null
  );
}

export function eventToShortcut(event: KeyboardEvent) {
  const parts: string[] = [];
  if (event.metaKey) parts.push("Meta");
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const key = normalizeShortcutKey(event.key);
  if (!key) {
    return "";
  }

  parts.push(key);
  return parts.join("+");
}

export function matchesShortcut(
  event: KeyboardEvent,
  binding: string | null | undefined,
) {
  if (!binding) {
    return false;
  }

  const parts = binding.split("+");
  const key = parts.at(-1);
  const modifiers = new Set(parts.slice(0, -1));

  if (event.metaKey !== modifiers.has("Meta")) return false;
  if (event.ctrlKey !== modifiers.has("Control")) return false;
  if (event.altKey !== modifiers.has("Alt")) return false;
  if (event.shiftKey !== modifiers.has("Shift")) return false;

  if (key === "Digit") {
    return /^[1-9]$/.test(event.key);
  }

  return normalizeShortcutKey(event.key) === key;
}

export function formatShortcut(binding: string | null | undefined) {
  if (!binding) {
    return "Not set";
  }

  return binding
    .replaceAll("Meta", isMacPlatform() ? "⌘" : "Ctrl")
    .replaceAll("Control", isMacPlatform() ? "⌃" : "Ctrl")
    .replaceAll("Alt", isMacPlatform() ? "⌥" : "Alt")
    .replaceAll("Shift", isMacPlatform() ? "⇧" : "Shift")
    .replaceAll("Digit", "1-9")
    .replaceAll("+", "");
}

function normalizeShortcutKey(key: string) {
  if (["Meta", "Control", "Alt", "Shift"].includes(key)) return "";
  if (key === " ") return "Space";
  if (key === "Escape") return "Escape";
  if (key === ",") return ",";
  if (key.length === 1) return key.toUpperCase();
  if (/^Arrow/.test(key)) return key;
  if (/^F\d{1,2}$/.test(key)) return key;
  return key.length > 0 ? key : "";
}
