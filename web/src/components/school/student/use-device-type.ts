"use client";

import { useSyncExternalStore } from "react";

export type DeviceType = "desktop" | "mobile";

// User-agent regex — same heuristic as the telemetry hook's device hint.
const MOBILE_UA = /Mobi|Android|iPhone|iPad/i;

function getSnapshot(): DeviceType {
  if (typeof window === "undefined") return "desktop";
  return MOBILE_UA.test(window.navigator.userAgent || "") ? "mobile" : "desktop";
}

// UA doesn't change over the session — no-op subscription.
function subscribe(): () => void {
  return () => {};
}

function getServerSnapshot(): DeviceType {
  return "desktop";
}

/**
 * Coarse device-type detection based on the user agent. Used for:
 *   - Flexing the integrity-chat time budget (mobile typing is ~2x
 *     slower so budgets expand on mobile).
 *   - Reporting a device hint in telemetry for teacher context.
 *
 * Uses useSyncExternalStore so SSR returns "desktop" and the client
 * reads the real UA on hydration without the "cascading render"
 * pattern that effects-based detection triggers.
 */
export function useDeviceType(): DeviceType {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
