import { create } from "zustand";

type ThemeSetting = "light" | "dark" | "system";

interface ThemeState {
  setting: ThemeSetting;
  resolved: "light" | "dark";
  toggle: () => void;
  hydrate: () => void;
}

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyResolved(resolved: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", resolved);
}

const CYCLE: ThemeSetting[] = ["system", "light", "dark"];

export const useThemeStore = create<ThemeState>((set, get) => ({
  setting: "system",
  resolved: "light",

  toggle: () => {
    const current = get().setting;
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
    const resolved = next === "system" ? getSystemTheme() : next;
    localStorage.setItem("veradic-theme", next);
    applyResolved(resolved);
    set({ setting: next, resolved });
  },

  hydrate: () => {
    const stored = localStorage.getItem("veradic-theme") as ThemeSetting | null;
    const setting = stored ?? "system";
    const resolved = setting === "system" ? getSystemTheme() : setting;
    applyResolved(resolved);
    set({ setting, resolved });

    // Listen for system theme changes when in "system" mode
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      const { setting: s } = get();
      if (s === "system") {
        const r = getSystemTheme();
        applyResolved(r);
        set({ resolved: r });
      }
    });
  },
}));
