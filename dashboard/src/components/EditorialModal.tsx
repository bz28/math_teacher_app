import { useEffect, useId, useRef, type ReactNode } from "react";
import { overlay } from "../lib/styles";

/**
 * Editorial modal shell — the chrome that wraps every form modal in
 * the admin console. Standardizes:
 *
 * - Backdrop tap and Escape key both dismiss via `onClose`.
 * - Top accent bar in --accent (the burnt-sienna mark that signals
 *   "this is an intake surface").
 * - Eyebrow label / serif h2 title / italic-serif subtitle stack —
 *   the editorial pattern established by the Add Lead intake card.
 * - Close button in the top-right corner.
 * - role="dialog" + aria-modal + aria-labelledby wired to the title.
 * - Focus returns to whatever was focused at mount time when the
 *   modal unmounts, so keyboard users don't get stranded at the
 *   document root after a dismiss.
 *
 * The form body lives inside `children`. Pages typically pad it with
 * `style={{ padding: "26px 36px 32px" }}` to match the intake-card
 * rhythm; that's left to the caller so a smaller modal (delete
 * confirm, single-field edit) can tighten the rhythm.
 */
export function EditorialModal({
  eyebrow,
  title,
  titleSize = 26,
  subtitle,
  onClose,
  maxWidth = 560,
  children,
}: {
  eyebrow?: string;
  title: string;
  /** Title font-size in px. The Add Lead intake card uses 32px for
   *  hero emphasis; smaller modals (Schedule, Note, Convert) use
   *  the 26px default which sits closer to body type. */
  titleSize?: number;
  subtitle?: string;
  onClose: () => void;
  maxWidth?: number;
  children: ReactNode;
}) {
  const titleId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  // Always-fresh callback ref. Updated inside an effect (not in render)
  // to satisfy react-hooks/refs — mutating ref.current during render is
  // flagged because it can cause stale-render bugs in concurrent mode.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      triggerRef.current?.focus?.();
    };
  }, []);

  return (
    <div
      style={overlay}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
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
          <h2 id={titleId} style={{ marginBottom: subtitle ? 6 : 0, fontSize: titleSize, letterSpacing: "-0.3px" }}>
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
