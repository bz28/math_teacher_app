import { useEffect, useRef, useState } from "react";

/* ── Pagination ───────────────────────────────────────────────── */

interface PaginationProps {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}

export function Pagination({ offset, limit, total, onChange }: PaginationProps) {
  if (total <= limit) return null; // single page — hide entirely

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 0 0", borderTop: "1px solid #f1f5f9", marginTop: 8,
    }}>
      <span style={{ fontSize: 12, color: "#94a3b8" }}>
        {offset + 1}&ndash;{Math.min(offset + limit, total)} of {total}
      </span>
      <div style={{ display: "flex", gap: 4 }}>
        <PageBtn disabled={page <= 1} onClick={() => onChange(0)}>
          First
        </PageBtn>
        <PageBtn disabled={page <= 1} onClick={() => onChange(offset - limit)}>
          Prev
        </PageBtn>
        <span style={{
          padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "#334155",
        }}>
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

function PageBtn({ disabled, onClick, children }: {
  disabled: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "6px 10px", fontSize: 12, fontWeight: 500,
        border: "1px solid #e2e8f0", borderRadius: 6,
        background: disabled ? "#f8fafc" : "#fff",
        color: disabled ? "#cbd5e1" : "#475569",
        cursor: disabled ? "default" : "pointer",
        transition: "all 0.1s",
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
}

export function SearchInput({
  value, onChange, placeholder = "Search...", debounceMs = 300,
}: SearchInputProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sync external resets (e.g. clearing from parent)
  useEffect(() => { setLocal(value); }, [value]);

  const handleChange = (v: string) => {
    setLocal(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), debounceMs);
  };

  return (
    <input
      type="text"
      value={local}
      onChange={(e) => handleChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8,
        fontSize: 13, fontWeight: 500, background: "#fff", color: "#334155",
        width: 220, transition: "border-color 0.15s",
        outline: "none",
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = "#6366f1"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; }}
    />
  );
}
