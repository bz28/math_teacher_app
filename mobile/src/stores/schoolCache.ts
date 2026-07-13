import { create } from "zustand";

/**
 * A tiny per-key cache for the school student's tab screens (Home / Grades /
 * Practice). App.tsx renders one tab at a time, so every tab switch unmounts
 * the prior screen and remounts the next — without this, a revisited tab
 * re-runs its fetch from scratch and flashes a full-height skeleton over data
 * the app just had. Screens read from here through `useCachedResource`, which
 * hydrates them with the last data instantly and refreshes in the background;
 * the skeleton shows only on the true first load (nothing cached yet).
 *
 * Values are stored untyped — each screen owns its own shape, and
 * `useCachedResource` is the typed door onto this store, so callers never poke
 * at `entries` directly.
 */
interface CacheEntry {
  data: unknown;
  loaded: boolean;
}

interface SchoolCacheState {
  entries: Record<string, CacheEntry>;
  setEntry: (key: string, data: unknown) => void;
}

export const useSchoolCacheStore = create<SchoolCacheState>((set) => ({
  entries: {},
  setEntry: (key, data) =>
    set((s) => ({ entries: { ...s.entries, [key]: { data, loaded: true } } })),
}));
