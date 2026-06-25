"use client";

import { useCallback } from "react";

// Editorial confetti — the brand green family plus one warm accent, read from
// the live CSS tokens at fire time so it tracks light/dark mode. (Previously a
// hardcoded coral/blue/amber set that appeared nowhere else in the product — a
// jarring tonal break in the proudest moment.)
function brandColors(): string[] {
  const fallback = ["#0E5238", "#2F8F66", "#E6F0EA", "#A66B15"];
  if (typeof window === "undefined") return fallback;
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => s.getPropertyValue(name).trim() || fb;
  return [
    v("--color-primary", "#0E5238"),
    v("--color-primary-light", "#2F8F66"),
    v("--color-primary-bg", "#E6F0EA"),
    v("--color-warning", "#A66B15"),
  ];
}

export function useConfetti() {
  const fire = useCallback(async (intense = false) => {
    const confetti = (await import("canvas-confetti")).default;
    confetti({
      particleCount: intense ? 200 : 100,
      spread: intense ? 120 : 70,
      origin: { y: 0.6 },
      colors: brandColors(),
    });
  }, []);

  return { fire };
}
