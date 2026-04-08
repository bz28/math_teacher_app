import { useEffect, useState } from "react";
import { Appearance, ColorSchemeName } from "react-native";
import * as SecureStore from "expo-secure-store";

export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "theme_preference";

let listeners: Array<(p: ThemePref) => void> = [];
let currentPref: ThemePref = "system";

/** Hydrate the saved preference from secure storage on app start. */
export async function loadThemePref(): Promise<ThemePref> {
  try {
    const saved = (await SecureStore.getItemAsync(STORAGE_KEY)) as ThemePref | null;
    if (saved === "system" || saved === "light" || saved === "dark") {
      currentPref = saved;
      return saved;
    }
  } catch {
    // Ignore — fall through to default
  }
  currentPref = "system";
  return "system";
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  currentPref = pref;
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, pref);
  } catch {
    // Best-effort persistence
  }
  listeners.forEach((cb) => cb(pref));
}

/** React hook returning the current preference and the resolved color scheme. */
export function useThemePref() {
  const [pref, setPref] = useState<ThemePref>(currentPref);
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(Appearance.getColorScheme());

  useEffect(() => {
    const cb = (next: ThemePref) => setPref(next);
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  }, []);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystemScheme(colorScheme));
    return () => sub.remove();
  }, []);

  const resolved: "light" | "dark" =
    pref === "system" ? (systemScheme === "dark" ? "dark" : "light") : pref;

  return { pref, resolved, setPref: setThemePref };
}
