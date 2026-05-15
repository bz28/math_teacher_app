import type { ReactNode } from "react";
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
 * just a tight title + message + button row. Auto-focuses the
 * confirm button so a teacher can hit Enter.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const confirmStyle =
    variant === "danger"
      ? { ...btnPrimary, background: "var(--danger)" }
      : btnPrimary;

  return (
    <div style={overlay} onClick={() => !busy && onCancel()}>
      <div
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
        <h3 style={{ marginBottom: 8 }}>{title}</h3>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.5, marginBottom: 18 }}>
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} disabled={busy} style={btnGhost}>
            {cancelLabel}
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            disabled={busy}
            style={{ ...confirmStyle, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
