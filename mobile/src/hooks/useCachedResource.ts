import { useCallback, useEffect, useRef, useState } from "react";
import { useSchoolCacheStore } from "../stores/schoolCache";

export interface CachedResource<T> {
  /** Last-known data, or undefined until the first successful load. */
  data: T | undefined;
  /** True only on the true first load (nothing cached). Drives the skeleton. */
  loading: boolean;
  /** True while a user-initiated pull-to-refresh fetch is in flight. */
  refreshing: boolean;
  /** True when a load failed AND there's no cached data to fall back on. */
  error: boolean;
  /** (Re)fetch; pass true for a user-initiated refresh (skips the skeleton). */
  load: (isRefresh?: boolean) => Promise<void>;
  /** Toggle the refreshing flag (wire to RefreshControl's onRefresh). */
  setRefreshing: (v: boolean) => void;
}

/**
 * Hydrate a school tab screen from `useSchoolCacheStore` so a revisited tab
 * shows its last data instantly and refreshes in the background. See the store
 * for the why.
 *
 * `key` namespaces the cache; `loader` returns the screen's derived data. The
 * loader may have a fresh identity each render (inline closure) — it's read
 * through a ref, so `load` and the mount effect stay stable and don't re-fire
 * on every render.
 */
export function useCachedResource<T>(
  key: string,
  loader: () => Promise<T>,
): CachedResource<T> {
  const data = useSchoolCacheStore((s) => s.entries[key]?.data) as T | undefined;
  const hasCache = useSchoolCacheStore((s) => s.entries[key]?.loaded ?? false);
  const setEntry = useSchoolCacheStore((s) => s.setEntry);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  // Initial mount with a warm cache starts non-loading, so the remounted tab
  // renders its cached data straight away instead of a skeleton.
  const [loading, setLoading] = useState(!hasCache);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      // Read cached-ness fresh (not the closed-over render value) so the
      // skeleton never reappears once anything is cached.
      const cached = () => useSchoolCacheStore.getState().entries[key]?.loaded ?? false;
      if (!isRefresh && !cached()) setLoading(true);
      setError(false);
      try {
        setEntry(key, await loaderRef.current());
      } catch {
        // A failed background refresh keeps the cached data on screen; only a
        // true first-load failure (nothing cached) surfaces the error state.
        if (!cached()) setError(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [key, setEntry],
  );

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, refreshing, error, load, setRefreshing };
}
