import { useEffect, useState, useSyncExternalStore } from "react";
import { cachedSelector } from "./cachedSelector";
import { getState, subscribe, tick } from "./store";
import type { SeaShieldState } from "./types";

export function useSeaShield<T>(selector: (s: SeaShieldState) => T): T {
  const [select] = useState(() => cachedSelector<SeaShieldState, T>());
  const getSnapshot = () => select(getState(), selector);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Ambient telemetry loop — mounted once by the app shell. */
export function useTelemetryClock(intervalMs = 3000) {
  useEffect(() => {
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}
