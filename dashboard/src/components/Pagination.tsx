import { useEffect, useRef, useState } from "react";

/* ── Pagination ───────────────────────────────────────────────── */

interface PaginationProps {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}

export function Pagination({ offset, limit, total, onChange }: PaginationProps) {
  if (total <= limit) return null;

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 0 0",
        borderTop: "1px solid var(--rule)",
        marginTop: 8,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--muted)",
        }}
      >
        {offset + 1}&ndash;{Math.min(offset + limit, total)} of {total}
      </span>
      <div style={{ display: "flex", gap: 4 }}>
        <PageBtn disabled={page <= 1} onClick={() => onChange(0)}>
          First
        </PageBtn>
        <PageBtn disabled={page <= 1} onClick={() => onChange(offset - limit)}>
          Prev
        </PageBtn>
        <span
          style={{
            padding: "6px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--ink)",
          }}
        >
          {page} / {totalPages}
        </span>
        <PageBtn disabled={page >= totalPages} onClick={() => onChange(offset + limit)}>
          Next
        </PageBtn>
        <PageBtn disabled={page >= totalPages} onClick={() => onChange((totalPages - 1) * limit)}>
          Last
        </PageBtn>
      </div>
    </div>
  );
}

function PageBtn({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "6px 12px",
        fontFamily: "var(--font-sans)",
        fontSize: 11.5,
        fontWeight: 500,
        letterSpacing: 0.3,
        border: "1px solid var(--rule)",
        borderRadius: 3,
        background: disabled ? "transparent" : "var(--surface)",
        color: disabled ? "var(--muted-2)" : "var(--ink-soft)",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ── SearchInput (debounced) ──────────────────────────────────── */

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  ariaLabel?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  debounceMs = 300,
  ariaLabel,
}: SearchInputProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { setLocal(value); }, [value]);

  const handleChange = (v: string) => {
    setLocal(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), debounceMs);
  };

  // Style comes from the global `input[type="text"]` rule so the focus
  // border picks up the accent. Width override is the only inline.
  return (
    <input
      type="text"
      value={local}
      onChange={(e) => handleChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      style={{ width: 240 }}
    />
  );
}
