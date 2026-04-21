function legacyCopyText(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  const selection = document.getSelection();
  const originalRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      if (originalRange) {
        selection.addRange(originalRange);
      }
    }
  }

  return copied;
}

export async function copyTextToClipboard(
  text: string,
  label = "text",
): Promise<boolean> {
  const errors: string[] = [];

  try {
    if (legacyCopyText(text)) {
      return true;
    }
  } catch (error) {
    if (error instanceof Error && error.message.trim()) {
      errors.push(error.message);
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.trim()) {
      errors.push(error.message);
    }
  }

  try {
    const { readText, writeText } =
      await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    try {
      const copied = await readText();
      if (copied === text) {
        return true;
      }
    } catch {
      return true;
    }
  } catch (error) {
    if (error instanceof Error && error.message.trim()) {
      errors.push(error.message);
    }
  }

  const detail = errors.find((value) => value.trim());
  window.alert(
    detail ? `Failed to copy ${label}. ${detail}` : `Failed to copy ${label}.`,
  );
  return false;
}
