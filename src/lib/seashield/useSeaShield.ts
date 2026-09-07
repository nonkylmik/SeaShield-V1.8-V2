import { useEffect, useSyncExternalStore } from "react";
import { getState, subscribe, tick } from "./store";
import type { SeaShieldState } from "./types";

const snapshot = () => getState();

export function useSeaShield<T>(selector: (s: SeaShieldState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(snapshot()),
    () => selector(snapshot()),
  );
}

/** Ambient telemetry loop — mounted once by the app shell. */
export function useTelemetryClock(intervalMs = 3000) {
  useEffect(() => {
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}
