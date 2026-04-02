/**
 * Shared inline style constants used across admin dashboard pages.
 * Import these instead of duplicating per-file.
 */

export const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #e2e8f0",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

export const btnPrimary: React.CSSProperties = {
  padding: "10px 24px",
  background: "#6366f1",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 14,
};

export const btnGhost: React.CSSProperties = {
  padding: "6px 14px",
  background: "none",
  color: "#64748b",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

export const btnSmall: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid #e2e8f0",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 600,
  color: "#6366f1",
};

export const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
};
