import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

// Note: theme preference is stored in SecureStore purely because it's the
// only persistent storage already wired up in this project (see
// services/api.ts for auth tokens). Ideally this would live in
// AsyncStorage/MMKV — SecureStore's keychain round-trip is wasted here for
// non-sensitive data — but introducing a new native dep is out of scope
// for a UI review branch. Revisit when we next touch native dependencies.

export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "theme_preference";
const CYCLE: ThemePref[] = ["system", "light", "dark"];

interface ThemePrefStore {
  pref: ThemePref;
  setPref: (p: ThemePref) => Promise<void>;
  toggle: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useThemePrefStore = create<ThemePrefStore>((set, get) => ({
  pref: "system",
  setPref: async (p) => {
    set({ pref: p });
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, p);
    } catch {
      // Best-effort persistence
    }
  },
  toggle: async () => {
    const current = get().pref;
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    await get().setPref(next);
  },
  hydrate: async () => {
    try {
      const saved = (await SecureStore.getItemAsync(STORAGE_KEY)) as ThemePref | null;
      if (saved === "system" || saved === "light" || saved === "dark") {
        set({ pref: saved });
      }
    } catch {
      // Ignore
    }
  },
}));

/** Convenience: hydrate from storage on app start. */
export const loadThemePref = () => useThemePrefStore.getState().hydrate();

/** React hook returning the current preference + resolved color scheme. */
export function useThemePref() {
  const pref = useThemePrefStore((s) => s.pref);
  const setPref = useThemePrefStore((s) => s.setPref);
  const toggle = useThemePrefStore((s) => s.toggle);
  // useColorScheme() is a React hook that reliably tracks the OS
  // appearance — more stable than Appearance.getColorScheme() which
  // returns null in some Expo Go scenarios.
  const systemScheme = useColorScheme();

  const resolved: "light" | "dark" =
    pref === "system" ? (systemScheme === "dark" ? "dark" : "light") : pref;

  return { pref, resolved, setPref, toggle };
}
