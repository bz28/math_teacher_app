import type { ReactNode } from "react";

/** Form field wrapper with a small uppercase label above the input. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-text-muted">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
