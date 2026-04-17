"use client";

import { useEffect, useId, useRef, useState } from "react";
import { student } from "@/lib/api";

/**
 * Join-code modal for the school-student sidebar. Behaves like a
 * proper a11y-compliant dialog:
 * - role="dialog", aria-modal, aria-labelledby at the heading.
 * - ESC closes; overlay click closes; Cancel closes.
 * - Body scroll locked while open so the page underneath doesn't
 *   drift when the user scrolls.
 * - Focus moves to the code input on open and returns to the
 *   previously focused element on close.
 * - Tab/Shift+Tab wrap inside the modal (simple focus trap).
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const headingId = useId();

  // Reset form + stash the previously-focused element each time the
  // modal opens. On close we restore focus there — standard dialog
  // behavior so keyboard users land back on the "+" button they
  // invoked us from.
  useEffect(() => {
    if (open) {
      setCode("");
      setError("");
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (returnFocusRef.current) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [open]);

  // ESC + focus trap + body scroll lock. One effect keeps the
  // listener lifecycle tied to `open` so we never leak it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="w-full max-w-sm rounded-[--radius-xl] border border-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={headingId} className="text-lg font-bold text-text-primary">
          Join a class
        </h2>
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
            aria-label="Class code"
            aria-invalid={!!error}
            className="w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-center text-base font-mono font-semibold tracking-[0.3em] text-text-primary outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-text-muted focus:border-primary"
          />
          {error && (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          )}
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
