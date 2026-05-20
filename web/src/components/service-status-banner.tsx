"use client";

import { useSyncExternalStore } from "react";
import { apiHealth } from "@/lib/api";

/**
 * Fixed-position banner that surfaces when the API client has hit a
 * network error (backend unreachable, CORS preflight blocked by a
 * dead container, DNS failure). Mounted once at the app root.
 *
 * The flag is global — managed by `apiHealth` in lib/api.ts — so it
 * works whether the failure originated in a form submit, an
 * auto-refresh, or a token refresh that races behind the scenes.
 * Any successful response from the server clears it.
 *
 * The user-facing copy never blames the user's connection: that's
 * almost always wrong (their network was fine, our backend was
 * dead) and it produces noise tickets when it's wrong. We hedge
 * with "we're having trouble reaching our servers" instead.
 */
// `useSyncExternalStore` keeps React in sync with the global
// apiHealth flag without the cascading-render footgun of setState-
// in-effect. SSR snapshot returns `false` so server-rendered HTML
// never includes the banner — it only flips on after a client-side
// request fails.
const getSnapshot = () => apiHealth.isDown();
const getServerSnapshot = () => false;

export default function ServiceStatusBanner() {
  const down = useSyncExternalStore(apiHealth.subscribe, getSnapshot, getServerSnapshot);

  if (!down) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[1000] border-b border-amber-300 bg-amber-50 text-amber-900 shadow-sm"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2.5 text-sm">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="inline-flex h-2 w-2 flex-none rounded-full bg-amber-500" />
          <p className="min-w-0 truncate">
            <span className="font-semibold">We&apos;re having trouble reaching our servers.</span>{" "}
            <span className="text-amber-800/80">
              Working on it — please try again in a moment.
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex-none rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
