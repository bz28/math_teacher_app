import { useEffect, useState } from "react";
import { Appearance, ColorSchemeName } from "react-native";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

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
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(Appearance.getColorScheme());

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystemScheme(colorScheme));
    return () => sub.remove();
  }, []);

  const resolved: "light" | "dark" =
    pref === "system" ? (systemScheme === "dark" ? "dark" : "light") : pref;

  return { pref, resolved, setPref, toggle };
}
