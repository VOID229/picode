import { useEffect, useEffectEvent } from "react";
import { listenToTerminalEvents } from "../lib/tauri";
import { useAppStore } from "../state/useAppStore";

export function useTerminalBridge() {
  const applyTerminalEvent = useAppStore((state) => state.applyTerminalEvent);
  const setConnectionReady = useAppStore((state) => state.setConnectionReady);

  const handleEvent = useEffectEvent(
    (event: Parameters<typeof applyTerminalEvent>[0]) => {
      applyTerminalEvent(event);
    },
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listenToTerminalEvents((event) => {
      handleEvent(event);
      setConnectionReady(true);
    }).then((dispose) => {
      unlisten = dispose;
      setConnectionReady(true);
    });

    return () => {
      unlisten?.();
    };
  }, [handleEvent, setConnectionReady]);
}
