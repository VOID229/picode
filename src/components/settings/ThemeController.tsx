import { useEffect } from "react";
import type { PropsWithChildren } from "react";
import { useAppStore } from "../../state/useAppStore";

export function ThemeController({ children }: PropsWithChildren) {
  const theme = useAppStore(
    (state) => state.state?.preferences.theme ?? "dark",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return children;
}
