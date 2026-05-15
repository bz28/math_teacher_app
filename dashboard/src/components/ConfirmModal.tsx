import { useEffect, useId, useRef, type ReactNode } from "react";
import { btnGhost, btnPrimary, overlay } from "../lib/styles";

/**
 * Lightweight confirmation modal replacing browser `confirm()`. The
 * browser dialog is fast but breaks the warm-paper palette and can't
 * carry styling/markup, so destructive prompts and "are you sure"
 * gates land outside the design system whenever they fire.
 *
 * `variant="danger"` paints the confirm button in --danger and is
 * the default for delete prompts. `variant="primary"` is for
 * non-destructive confirms (e.g., "Activate this school?").
 *
 * Smaller chrome than the form modals — no eyebrow, no accent bar,
 * just a tight title + message + button row. Escape cancels for
 * parity with the native dialog. For `variant="primary"` we
 * auto-focus the confirm button so Enter is a one-tap accept; for
 * `variant="danger"` we auto-focus Cancel so a stray Enter doesn't
 * delete anything.
 *
 * `role="dialog"` + `aria-modal` + `aria-labelledby` / `-describedby`
 * tie the modal into screen-reader announcements; focus is returned
 * to whatever the user had focused at mount-time when the modal
 * unmounts.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  // Always-fresh callback ref. Updated inside an effect (not in render)
  // to satisfy react-hooks/refs — mutating ref.current during render is
  // flagged because it can cause stale-render bugs in concurrent mode.
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      triggerRef.current?.focus?.();
    };
  }, []);

  const confirmStyle =
    variant === "danger"
      ? { ...btnPrimary, background: "var(--danger)" }
      : btnPrimary;

  return (
    <div style={overlay} onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="table-card"
        style={{
          maxWidth: 440,
          width: "92%",
          background: "var(--surface)",
          borderRadius: 2,
          boxShadow: "0 16px 48px rgba(20, 19, 15, 0.18)",
          padding: "22px 26px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} style={{ marginBottom: 8 }}>{title}</h3>
        <div id={messageId} style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5, marginBottom: 18 }}>
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button autoFocus={variant === "danger"} onClick={onCancel} style={btnGhost}>
            {cancelLabel}
          </button>
          <button autoFocus={variant !== "danger"} onClick={onConfirm} style={confirmStyle}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
