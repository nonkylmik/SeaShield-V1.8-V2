import { useEffect, useState, useSyncExternalStore } from "react";
import { cachedSelector } from "./cachedSelector";
import { getHydrationState, getState, subscribe, tick } from "./store";
import type { SeaShieldState } from "./types";

export function useSeaShield<T>(selector: (s: SeaShieldState) => T): T {
  const [select] = useState(() => cachedSelector<SeaShieldState, T>());
  const [selectHydration] = useState(() => cachedSelector<SeaShieldState, T>());
  const getSnapshot = () => select(getState(), selector);
  // Server rendering and hydration read the seed data the server rendered (see store.ts).
  const getServerSnapshot = () => selectHydration(getHydrationState(), selector);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Ambient telemetry loop — mounted once by the app shell. */
export function useTelemetryClock(intervalMs = 3000) {
  useEffect(() => {
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}
