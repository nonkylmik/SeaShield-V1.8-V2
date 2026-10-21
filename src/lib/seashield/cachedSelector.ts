/**
 * Memoizes one selector result per state snapshot. useSyncExternalStore requires
 * getSnapshot to return the same value until the store changes; selectors that
 * build new arrays (e.g. `.filter`) otherwise loop until React aborts the render.
 * The store replaces its state object on every emit, so identity marks a change.
 */
export function cachedSelector<S, T>() {
  let cached: { state: S; selector: (state: S) => T; value: T } | undefined;
  return (state: S, selector: (state: S) => T): T => {
    if (cached?.state !== state || cached.selector !== selector) {
      cached = { state, selector, value: selector(state) };
    }
    return cached.value;
  };
}
