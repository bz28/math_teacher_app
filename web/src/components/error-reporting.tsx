"use client";

import { useEffect } from "react";
import { installGlobalErrorReporting } from "@/lib/report-error";

/**
 * Installs the global `error` / `unhandledrejection` listeners once for
 * the whole app. Renders nothing.
 *
 * These two catch what the React ErrorBoundary structurally cannot: a
 * throw outside render (an event handler, a timer, an async callback) and
 * a rejected promise nobody awaited. Those are the majority of real-world
 * client failures, and before this they left no trace at all in
 * production.
 *
 * Mounted in the root layout so it covers every route, including the
 * unauthenticated ones — the login page can crash too, and that's exactly
 * the crash we'd otherwise never hear about.
 */
export default function ErrorReporting() {
  useEffect(() => installGlobalErrorReporting(), []);
  return null;
}
