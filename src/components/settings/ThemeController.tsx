import { useEffect } from "react";
import type { PropsWithChildren } from "react";
import { useAppStore } from "../../state/useAppStore";
import { getThemeColors, getThemeIsDark } from "../../lib/themes";

const THEME_STORAGE_KEY = "picode.theme";

export function ThemeController({ children }: PropsWithChildren) {
  const state = useAppStore((s) => s.state);
  const theme = state?.preferences.theme ?? "dark";
  const customColors = state?.preferences.customThemeColors;

  useEffect(() => {
    const colors = getThemeColors(theme, customColors);
    const isDark = getThemeIsDark(theme);
    const root = document.documentElement;

    root.dataset.theme = isDark ? "dark" : "light";

    root.style.setProperty("--bg", colors.bg);
    root.style.setProperty("--surface", colors.surface);
    root.style.setProperty("--surface-elevated", colors.surfaceElevated);
    root.style.setProperty("--surface-strong", colors.surfaceStrong);
    root.style.setProperty("--line", colors.line);
    root.style.setProperty("--accent", colors.accent);
    root.style.setProperty("--accent-soft", colors.accentSoft);
    root.style.setProperty("--accent-glow", colors.accentGlow);
    root.style.setProperty("--success", colors.success);
    root.style.setProperty("--danger", colors.danger);
    root.style.setProperty("--warning", colors.warning);
    root.style.setProperty("--text", colors.text);
    root.style.setProperty("--text-muted", colors.textMuted);
    root.style.setProperty("--text-dim", colors.textDim);
    root.style.setProperty("--glass-bg", colors.glassBg);
    root.style.setProperty("--glass-border", colors.glassBorder);
    root.style.setProperty("--chat-bubble", colors.chatBubble);
    root.style.setProperty("--composer", colors.composer);
    root.style.setProperty("--composer-border", colors.composerBorder);

    root.style.backgroundColor = colors.bg;
    document.body.style.backgroundColor = colors.bg;
    document.body.style.color = colors.text;

    root.style.colorScheme = isDark ? "dark" : "light";

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures in constrained environments.
    }
  }, [theme, customColors]);

  return children;
}
