import { useEffect } from "react";
import type { PropsWithChildren } from "react";
import { useAppStore } from "../../state/useAppStore";

const THEME_STORAGE_KEY = "picode.theme";

export function ThemeController({ children }: PropsWithChildren) {
  const theme = useAppStore(
    (state) => state.state?.preferences.theme ?? "dark",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    const backgroundColor = theme === "light" ? "#ffffff" : "#121212";
    const textColor = theme === "light" ? "#09090b" : "#eaeaea";

    document.documentElement.style.backgroundColor = backgroundColor;
    document.body.style.backgroundColor = backgroundColor;
    document.body.style.color = textColor;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures in constrained environments.
    }
  }, [theme]);

  return children;
}
