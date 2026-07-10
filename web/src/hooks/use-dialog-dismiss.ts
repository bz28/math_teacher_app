import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog keyboard + focus behavior for the bespoke teacher wizard modals
 * that can't drop into the shared <Modal> (they carry their own
 * max-height/flex-column/scroll chrome and a stacked upgrade prompt).
 * Provides exactly what <Modal> gives its dialogs so the two stay in
 * sync: Escape-to-close, a Tab focus-trap, initial focus into the panel,
 * a body scroll-lock, and focus restoration on unmount.
 *
 * Attach the returned ref to the dialog panel (the element that should
 * also carry `role="dialog" aria-modal="true"`). Pass `dismissible:
 * false` (e.g. while a request is in flight) to suppress Escape without
 * tearing down the trap.
 *
 * Every dismiss path (Escape here, plus backdrop / ✕ in the host) should
 * route through the returned `requestClose` so the guard lives in one
 * place. When `confirmClose` returns true for an attempt, we call
 * `onConfirmClose` instead of `onClose` — the hook for a "discard your
 * unsaved work?" prompt before a dirty wizard tears itself down.
 */
export function useDialogDismiss({
  onClose,
  dismissible = true,
  confirmClose,
  onConfirmClose,
}: {
  onClose: () => void;
  dismissible?: boolean;
  /** Return true to intercept a dismiss attempt (e.g. the form is dirty). */
  confirmClose?: () => boolean;
  /** Called in place of `onClose` when `confirmClose` returns true. */
  onConfirmClose?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // The single dismiss decision: no-op while suppressed, hand off to the
  // confirm prompt when the attempt is intercepted, otherwise close.
  const requestClose = useCallback(() => {
    if (!dismissible) return;
    if (confirmClose?.()) {
      onConfirmClose?.();
      return;
    }
    onClose();
  }, [dismissible, confirmClose, onConfirmClose, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        requestClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;
        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [requestClose],
  );

  // Focus management — runs once on open/close. Initial focus is only
  // claimed when nothing inside the panel is already focused, so a child
  // `autoFocus` (e.g. the title input) keeps its focus.
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const active = document.activeElement;
      if (active && panel.contains(active)) return;
      const first = panel.querySelector(FOCUSABLE_SELECTOR) as HTMLElement | null;
      first?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = "";
      previousFocusRef.current?.focus();
    };
  }, []);

  // Keyboard handler — re-binds when dismissible changes without
  // re-running the focus effect.
  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { panelRef, requestClose };
}
