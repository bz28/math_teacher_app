import { useState, type InputHTMLAttributes } from "react";

/**
 * A number input whose value lives in the URL. While the operator is mid-
 * edit (the field empty, or "1." on the way to "1.5") it shows what they
 * typed and commits only a whole number; on blur it shows the committed
 * value again. A plain controlled input snapped an emptied field straight
 * back to its default, so backspacing 92 and typing 3 gave 923.
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: number;
  onCommit: (v: string) => void;
};

export default function NumberField({ value, onCommit, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      {...rest}
      value={draft ?? String(value)}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (v.trim() !== "" && Number.isFinite(Number(v))) onCommit(v);
      }}
      onBlur={(e) => { setDraft(null); onBlur?.(e); }}
    />
  );
}
