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
