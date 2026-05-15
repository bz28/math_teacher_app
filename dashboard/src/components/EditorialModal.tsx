import type { ReactNode } from "react";
import { overlay } from "../lib/styles";

/**
 * Editorial modal shell — the chrome that wraps every form modal in
 * the admin console. Standardizes:
 *
 * - Backdrop tap-to-close (gated by `closeOnBackdrop`).
 * - Top accent bar in --accent (the burnt-sienna mark that signals
 *   "this is an intake surface").
 * - Eyebrow label / serif h2 title / italic-serif subtitle stack —
 *   the editorial pattern established by the Add Lead intake card.
 * - Close button in the top-right corner.
 *
 * The form body lives inside `children`. Pages typically pad it with
 * `style={{ padding: "26px 36px 32px" }}` to match the intake-card
 * rhythm; that's left to the caller so a smaller modal (delete
 * confirm, single-field edit) can tighten the rhythm.
 */
export function EditorialModal({
  eyebrow,
  title,
  subtitle,
  onClose,
  maxWidth = 560,
  closeOnBackdrop = true,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  maxWidth?: number;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={overlay}
      onClick={() => {
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        style={{
          position: "relative",
          maxWidth,
          width: "92%",
          maxHeight: "88vh",
          overflow: "auto",
          background: "var(--surface)",
          borderRadius: 2,
          boxShadow: "0 16px 48px rgba(20, 19, 15, 0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ height: 3, background: "var(--accent)", width: "100%" }} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 12,
            right: 14,
            width: 30,
            height: 30,
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            fontSize: 24,
            lineHeight: 1,
            cursor: "pointer",
            fontFamily: "var(--font-display)",
            borderRadius: 2,
          }}
        >
          ×
        </button>
        <div style={{ padding: "28px 36px 0" }}>
          {eyebrow && <span className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</span>}
          <h2 style={{ marginBottom: subtitle ? 6 : 0, fontSize: 26, letterSpacing: "-0.3px" }}>
            {title}
          </h2>
          {subtitle && (
            <p style={{
              fontFamily: "var(--font-display)", fontStyle: "italic",
              fontSize: 15, color: "var(--muted)", lineHeight: 1.4,
              maxWidth: "48ch", marginBottom: 0,
            }}>
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
