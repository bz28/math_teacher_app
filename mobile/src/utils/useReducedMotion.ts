import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Tracks the OS "Reduce Motion" accessibility setting. Defaults to false
 * (motion allowed) and flips to true if the student has the setting on, so
 * decorative animations (the "thinking" dots, etc.) can fall back to a calm
 * static rendering for motion-sensitive users. Optional-chained so the hook
 * is inert in test/render environments that don't implement the native API.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => {
        if (active) setReduced(!!v);
      })
      .catch(() => {
        /* unsupported — keep the motion-allowed default */
      });
    const sub = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      (v: boolean) => setReduced(!!v),
    );
    return () => {
      active = false;
      sub?.remove?.();
    };
  }, []);

  return reduced;
}
