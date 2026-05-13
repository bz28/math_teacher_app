/**
 * Shared inline style constants used across admin dashboard pages.
 * Token values mirror dashboard/src/index.css so modals/forms inherit
 * the same Operator's Console palette as their host pages.
 */

export const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 3,
  border: "1px solid var(--rule-strong)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontFamily: "var(--font-sans)",
  fontSize: 13.5,
  width: "100%",
  outline: "none",
};

export const btnPrimary: React.CSSProperties = {
  padding: "8px 18px",
  background: "var(--ink)",
  color: "var(--paper)",
  border: "none",
  borderRadius: 3,
  fontFamily: "var(--font-sans)",
  fontSize: 12.5,
  fontWeight: 600,
  letterSpacing: 0.3,
  cursor: "pointer",
};

export const btnGhost: React.CSSProperties = {
  padding: "7px 14px",
  background: "transparent",
  color: "var(--muted)",
  border: "1px solid var(--rule-strong)",
  borderRadius: 3,
  fontFamily: "var(--font-sans)",
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
};

export const btnSmall: React.CSSProperties = {
  padding: "4px 10px",
  fontFamily: "var(--font-sans)",
  fontSize: 11.5,
  borderRadius: 2,
  border: "1px solid var(--rule)",
  background: "var(--surface)",
  cursor: "pointer",
  fontWeight: 500,
  color: "var(--accent)",
};

export const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(20, 19, 15, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};
