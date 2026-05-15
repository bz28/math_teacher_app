import type { ChangeEvent, ReactNode } from "react";

/**
 * Styled checkbox matching the Operator's Console palette —
 * --rule-strong border on --surface when off, --accent fill + paper
 * check glyph when on. Wraps the native input with a fully-styled
 * pseudo-control so the appearance is consistent across browsers
 * (the native control's accent-color tint varies and bleeds into
 * the warm-paper palette).
 *
 * Use anywhere we need an "agree" / "include this" / "filter on"
 * toggle in a form or filter bar.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        userSelect: "none",
      }}
    >
      <span
        style={{
          position: "relative",
          width: 16,
          height: 16,
          flexShrink: 0,
          borderRadius: 3,
          border: `1px solid ${checked ? "var(--accent)" : "var(--rule-strong)"}`,
          background: checked ? "var(--accent)" : "var(--surface)",
          transition: "background 0.1s ease, border-color 0.1s ease",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            margin: 0,
            cursor: "inherit",
          }}
        />
        {checked && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path d="M1.5 5.5L4 8L8.5 2.5" stroke="var(--paper)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-soft)" }}>{label}</span>
    </label>
  );
}
