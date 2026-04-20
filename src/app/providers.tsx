import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { PropsWithChildren } from "react";
import { ThemeController } from "../components/settings/ThemeController";
import { usePiBridge } from "../services/piBridge";
import { useTerminalBridge } from "../services/terminalBridge";
import { useAppStore } from "../state/useAppStore";

function AppBootstrap() {
  const initialize = useAppStore((state) => state.initialize);

  usePiBridge();
  useTerminalBridge();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return null;
}

export function AppProviders({ children }: PropsWithChildren) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeController>{children}</ThemeController>
      <AppBootstrap />
    </QueryClientProvider>
  );
}
