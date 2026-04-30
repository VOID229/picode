import type { CustomThemeColors, ThemeId } from "../domains/types";

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceElevated: string;
  surfaceStrong: string;
  line: string;
  accent: string;
  accentSoft: string;
  accentGlow: string;
  success: string;
  danger: string;
  warning: string;
  text: string;
  textMuted: string;
  textDim: string;
  glassBg: string;
  glassBorder: string;
  chatBubble: string;
  composer: string;
  composerBorder: string;
  navHover: string;
}

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  isDark: boolean;
  colors: ThemeColors;
}

export const defaultCustomColors: CustomThemeColors = {
  bg: "#1a1b26",
  surface: "#1f2033",
  surfaceElevated: "#292b3e",
  surfaceStrong: "#383a52",
  line: "rgba(255, 255, 255, 0.06)",
  accent: "#7aa2f7",
  accentSoft: "rgba(122, 162, 247, 0.12)",
  accentGlow: "rgba(122, 162, 247, 0.4)",
  success: "#9ece6a",
  danger: "#f7768e",
  warning: "#e0af68",
  text: "#c0caf5",
  textMuted: "#787c99",
  textDim: "#565a75",
  glassBg: "#1a1b26",
  glassBorder: "rgba(255, 255, 255, 0.08)",
  chatBubble: "#292b3e",
  composer: "#1f2033",
  composerBorder: "rgba(255, 255, 255, 0.1)",
  navHover: "rgba(255, 255, 255, 0.06)",
};

export const themeDefinitions: ThemeDefinition[] = [
  {
    id: "dark",
    label: "Dark",
    isDark: true,
    colors: {
      bg: "#121212",
      surface: "#181818",
      surfaceElevated: "#242424",
      surfaceStrong: "#333333",
      line: "rgba(255, 255, 255, 0.06)",
      accent: "#3b82f6",
      accentSoft: "rgba(59, 130, 246, 0.1)",
      accentGlow: "rgba(59, 130, 246, 0.4)",
      success: "#10b981",
      danger: "#ef4444",
      warning: "#f59e0b",
      text: "#eaeaea",
      textMuted: "#bdbdb7",
      textDim: "#7f7f79",
      glassBg: "#121212",
      glassBorder: "rgba(255, 255, 255, 0.08)",
      chatBubble: "#2a2a2c",
      composer: "#18181a",
      composerBorder: "rgba(255, 255, 255, 0.1)",
      navHover: "rgba(255, 255, 255, 0.06)",
    },
  },
  {
    id: "light",
    label: "Light",
    isDark: false,
    colors: {
      bg: "#ffffff",
      surface: "#f4f4f5",
      surfaceElevated: "#e4e4e7",
      surfaceStrong: "#d4d4d8",
      line: "rgba(0, 0, 0, 0.08)",
      accent: "#2563eb",
      accentSoft: "rgba(37, 99, 235, 0.1)",
      accentGlow: "rgba(37, 99, 235, 0.3)",
      success: "#16a34a",
      danger: "#dc2626",
      warning: "#d97706",
      text: "#09090b",
      textMuted: "#52525b",
      textDim: "#71717a",
      glassBg: "rgba(255, 255, 255, 0.85)",
      glassBorder: "rgba(0, 0, 0, 0.08)",
      chatBubble: "#f4f4f5",
      composer: "#ffffff",
      composerBorder: "rgba(0, 0, 0, 0.12)",
      navHover: "rgba(0, 0, 0, 0.05)",
    },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    isDark: true,
    colors: {
      bg: "#282828",
      surface: "#2e2e2e",
      surfaceElevated: "#3c3836",
      surfaceStrong: "#504945",
      line: "rgba(255, 255, 255, 0.06)",
      accent: "#d65d0e",
      accentSoft: "rgba(214, 93, 14, 0.12)",
      accentGlow: "rgba(214, 93, 14, 0.4)",
      success: "#b8bb26",
      danger: "#fb4934",
      warning: "#fabd2f",
      text: "#ebdbb2",
      textMuted: "#a89984",
      textDim: "#7c6f64",
      glassBg: "#282828",
      glassBorder: "rgba(255, 255, 255, 0.08)",
      chatBubble: "#3c3836",
      composer: "#2e2e2e",
      composerBorder: "rgba(255, 255, 255, 0.1)",
      navHover: "rgba(255, 255, 255, 0.06)",
    },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    isDark: true,
    colors: {
      bg: "#1e1e2e",
      surface: "#181825",
      surfaceElevated: "#313244",
      surfaceStrong: "#45475a",
      line: "rgba(205, 214, 244, 0.06)",
      accent: "#89b4fa",
      accentSoft: "rgba(137, 180, 250, 0.12)",
      accentGlow: "rgba(137, 180, 250, 0.4)",
      success: "#a6e3a1",
      danger: "#f38ba8",
      warning: "#f9e2af",
      text: "#cdd6f4",
      textMuted: "#7f849c",
      textDim: "#585b70",
      glassBg: "#1e1e2e",
      glassBorder: "rgba(205, 214, 244, 0.08)",
      chatBubble: "#313244",
      composer: "#181825",
      composerBorder: "rgba(205, 214, 244, 0.1)",
      navHover: "rgba(205, 214, 244, 0.06)",
    },
  },
  {
    id: "nord",
    label: "Nord",
    isDark: true,
    colors: {
      bg: "#2e3440",
      surface: "#3b4252",
      surfaceElevated: "#434c5e",
      surfaceStrong: "#4c566a",
      line: "rgba(216, 222, 233, 0.07)",
      accent: "#88c0d0",
      accentSoft: "rgba(136, 192, 208, 0.12)",
      accentGlow: "rgba(136, 192, 208, 0.4)",
      success: "#a3be8c",
      danger: "#bf616a",
      warning: "#ebcb8b",
      text: "#d8dee9",
      textMuted: "#7b88a1",
      textDim: "#616e88",
      glassBg: "#2e3440",
      glassBorder: "rgba(216, 222, 233, 0.08)",
      chatBubble: "#3b4252",
      composer: "#2e3440",
      composerBorder: "rgba(216, 222, 233, 0.1)",
      navHover: "rgba(216, 222, 233, 0.06)",
    },
  },
  {
    id: "solarized",
    label: "Solarized",
    isDark: true,
    colors: {
      bg: "#002b36",
      surface: "#073642",
      surfaceElevated: "#0a4050",
      surfaceStrong: "#1a5566",
      line: "rgba(147, 161, 161, 0.1)",
      accent: "#268bd2",
      accentSoft: "rgba(38, 139, 210, 0.12)",
      accentGlow: "rgba(38, 139, 210, 0.4)",
      success: "#859900",
      danger: "#dc322f",
      warning: "#b58900",
      text: "#93a1a1",
      textMuted: "#657b83",
      textDim: "#586e75",
      glassBg: "#002b36",
      glassBorder: "rgba(147, 161, 161, 0.1)",
      chatBubble: "#073642",
      composer: "#002b36",
      composerBorder: "rgba(147, 161, 161, 0.12)",
      navHover: "rgba(147, 161, 161, 0.06)",
    },
  },
];

export const colorLabels: Record<keyof ThemeColors, string> = {
  bg: "Background",
  surface: "Surface",
  surfaceElevated: "Surface Elevated",
  surfaceStrong: "Surface Strong",
  line: "Border Line",
  accent: "Accent",
  accentSoft: "Accent Soft",
  accentGlow: "Accent Glow",
  success: "Success",
  danger: "Danger",
  warning: "Warning",
  text: "Text",
  textMuted: "Text Muted",
  textDim: "Text Dim",
  glassBg: "Glass Background",
  glassBorder: "Glass Border",
  chatBubble: "Chat Bubble",
  composer: "Composer",
  composerBorder: "Composer Border",
  navHover: "Nav Hover",
};

export function getThemeColors(
  themeId: ThemeId,
  customColors?: CustomThemeColors,
): ThemeColors {
  if (themeId === "custom" && customColors) {
    return { ...customColors };
  }
  const theme = themeDefinitions.find((t) => t.id === themeId);
  return theme?.colors ?? themeDefinitions[0].colors;
}

export function getThemeIsDark(themeId: ThemeId): boolean {
  if (themeId === "custom") return true;
  const theme = themeDefinitions.find((t) => t.id === themeId);
  return theme?.isDark ?? true;
}
