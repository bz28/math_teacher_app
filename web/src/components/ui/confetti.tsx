"use client";

import { useCallback } from "react";

const COLORS = ["#6C5CE7", "#A29BFE", "#00B894", "#FDCB6E", "#FF6B6B"];

export function useConfetti() {
  const fire = useCallback(async (intense = false) => {
    const confetti = (await import("canvas-confetti")).default;
    confetti({
      particleCount: intense ? 200 : 100,
      spread: intense ? 120 : 70,
      origin: { y: 0.6 },
      colors: COLORS,
    });
  }, []);

  return { fire };
}
