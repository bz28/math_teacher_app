"use client";

import { useEffect, useState } from "react";
import { getViewAsTeacher, setViewAsTeacher } from "@/lib/api";

/**
 * Persistent marker shown while an admin is reading a teacher's data.
 *
 * The bar is not decoration — it is the thing standing between "I am
 * debugging her account" and "I think this is my own account". It never
 * collapses, never auto-hides, and stays put on scroll, because the
 * failure it prevents is someone forgetting which view they are in while
 * looking at a real classroom's data.
 *
 * Entering the mode is a URL parameter (?view_as=<teacherId>) so the
 * admin dashboard can deep-link into it. The id is held in sessionStorage,
 * so the mode dies with the tab rather than lingering in a browser the
 * admin comes back to tomorrow.
 */
export default function ViewAsBanner() {
  const [teacherId, setTeacherId] = useState<string | null>(null);

  useEffect(() => {
    // Consume ?view_as= once, then strip it from the URL so the mode
    // isn't re-armed by a later back-navigation to this entry point.
    const params = new URLSearchParams(window.location.search);
    const incoming = params.get("view_as");
    if (incoming) {
      setViewAsTeacher(incoming);
      params.delete("view_as");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
    }
    setTeacherId(getViewAsTeacher());
  }, []);

  if (!teacherId) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-[100] flex items-center justify-center gap-3 bg-[color:var(--color-warning-bg)] px-4 py-2 text-[13px] text-[color:var(--color-warning-dark)] shadow-sm"
    >
      <span>
        <strong className="font-semibold">Viewing as a teacher</strong>
        {" — read only. Nothing you click here can change her data."}
      </span>
      <button
        type="button"
        onClick={() => {
          setViewAsTeacher(null);
          // Full reload rather than a router push: every cached response
          // in the app was fetched in her scope, and re-rendering without
          // discarding it would leave her data on screen under the
          // admin's own identity.
          window.location.reload();
        }}
        className="rounded-[--radius-sm] border border-[color:var(--color-warning-dark)]/30 px-2 py-0.5 text-[12px] font-semibold transition-colors hover:bg-[color:var(--color-warning-dark)]/10"
      >
        Exit
      </button>
    </div>
  );
}
