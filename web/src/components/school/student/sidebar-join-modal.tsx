"use client";

import { useEffect, useRef, useState } from "react";
import { student } from "@/lib/api";

/**
 * Join-code modal for the school-student sidebar. A thin pop-up that
 * runs the same joinSection flow the legacy class-list page had
 * inline — extracted here because the sidebar-first layout makes
 * "join another class" a one-off action, not a destination.
 *
 * Parent is responsible for toggling `open` and running `onJoined`
 * (which should refetch the sidebar class list).
 */
export function SidebarJoinModal({
  open,
  onClose,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  onJoined: () => void;
}) {
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the form whenever the modal re-opens. Avoids showing a
  // stale error from a previous attempt.
  useEffect(() => {
    if (open) {
      setCode("");
      setError("");
      // Focus after paint so the autofocus actually lands.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length < 4 || joining) return;
    setJoining(true);
    setError("");
    try {
      await student.joinSection(code.trim());
      onJoined();
      onClose();
    } catch (err) {
      setError((err as Error).message || "Invalid code");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[--radius-xl] border border-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary">Join a class</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Enter the code your teacher gave you.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError("");
            }}
            placeholder="Class code"
            maxLength={6}
            className="w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-center text-base font-mono font-semibold tracking-[0.3em] text-text-primary outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-text-muted focus:border-primary"
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-[--radius-sm] border border-border bg-transparent px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={code.trim().length < 4 || joining}
              className="flex-1 rounded-[--radius-sm] bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
            >
              {joining ? "Joining…" : "Join"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
