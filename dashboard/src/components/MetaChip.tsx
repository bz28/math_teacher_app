import { SUBJECT_COLOR, MODE_COLOR } from "../lib/quality";

/**
 * MetaChip — a tiny colored-dot label for a session's subject or mode.
 * Shared by the Solution-quality tab and its drill-in so a subject/mode
 * reads identically in the table, the chips, and the detail header.
 */
interface Props {
  label: string;
  kind: "subject" | "mode";
  /** The raw enum value (drives the dot color). */
  value: string;
}

export function MetaChip({ label, kind, value }: Props) {
  const color = (kind === "subject" ? SUBJECT_COLOR : MODE_COLOR)[value] ?? "var(--muted-2)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        color: "var(--ink-soft)",
        background: "var(--paper-2)",
        padding: "2px 8px",
        borderRadius: 2,
        whiteSpace: "nowrap",
        fontFamily: "var(--font-sans)",
      }}
    >
      <span aria-hidden style={{ width: 7, height: 7, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}
