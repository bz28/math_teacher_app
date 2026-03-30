import { create } from "zustand";

type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  hydrate: () => void;
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("veradic-theme", theme);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "light",

  toggle: () => {
    const next = get().theme === "light" ? "dark" : "light";
    applyTheme(next);
    set({ theme: next });
  },

  hydrate: () => {
    const stored = localStorage.getItem("veradic-theme") as Theme | null;
    const theme = stored === "dark" ? "dark" : "light";
    applyTheme(theme);
    set({ theme });
  },
}));
