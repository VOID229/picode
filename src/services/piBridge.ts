import { useEffect, useEffectEvent } from "react";
import { listenToPiEvents } from "../lib/tauri";
import { useAppStore } from "../state/useAppStore";

export function usePiBridge() {
  const applyRuntimeEvent = useAppStore((state) => state.applyRuntimeEvent);
  const setConnectionReady = useAppStore((state) => state.setConnectionReady);

  const handleEvent = useEffectEvent(
    (event: Parameters<typeof applyRuntimeEvent>[0]) => {
      applyRuntimeEvent(event);
    },
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listenToPiEvents((event) => {
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
