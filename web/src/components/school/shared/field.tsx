import type { ReactNode } from "react";

/** Form field wrapper with a small uppercase label above the input. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
