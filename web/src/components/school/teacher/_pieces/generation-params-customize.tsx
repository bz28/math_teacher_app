"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_GENERATION_PARAMS,
  type GenerationParams,
} from "@/lib/api";
import { Select } from "@/components/ui";

// localStorage key for the Customize-section selections. Per-teacher
// scoping happens implicitly because each teacher logs in on their
// own browser session; cross-teacher leakage on a shared device is
// the same risk every other form has and is out of scope.
const PARAMS_STORAGE_KEY = "veradic.generationParams";

// Labels + tooltip copy for the Customize dropdowns. Tied to the
// GenerationParams shape; defaults at index 0 of each list translate
// to "no prompt instruction" on the backend, so the 1-click flow is
// byte-identical when the teacher doesn't customize.
const PARAM_OPTIONS: {
  key: keyof GenerationParams;
  label: string;
  help: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "problem_type",
    label: "Problem type",
    help: "What shape the problems take.",
    options: [
      { value: "mixed", label: "Mixed" },
      { value: "word", label: "Word problems only" },
      { value: "computation", label: "Computation only" },
      { value: "multi_step", label: "Multi-step" },
      { value: "proof", label: "Proofs" },
    ],
  },
  {
    key: "answer_form",
    label: "Answer form",
    help: "How final answers should be expressed.",
    options: [
      { value: "auto", label: "Auto" },
      { value: "radical", label: "Radical form" },
      { value: "rational_exponent", label: "Rational exponent" },
      { value: "exact", label: "Exact (no decimals)" },
      { value: "decimal_2", label: "Decimal · 2 sig figs" },
      { value: "decimal_3", label: "Decimal · 3 sig figs" },
    ],
  },
  {
    key: "difficulty",
    label: "Difficulty",
    help:
      "Relative to this course's student level (not absolute math). " +
      "Ramp orders easy → hard across the set.",
    options: [
      { value: "mixed", label: "Mixed" },
      { value: "easy", label: "All easy" },
      { value: "medium", label: "All medium" },
      { value: "hard", label: "All hard" },
      { value: "ramp", label: "Easy → hard ramp" },
    ],
  },
  {
    key: "calculator",
    label: "Calculator",
    help:
      "No-calc keeps numerics clean (standard angles, integer evals). " +
      "Calculator-allowed lets the AI use messy decimals freely.",
    options: [
      { value: "either", label: "Either" },
      { value: "no_calc", label: "No calculator" },
      { value: "calc_allowed", label: "Calculator allowed" },
    ],
  },
  {
    key: "format",
    label: "Format",
    help:
      "MCQ poses the problem with 4 choices the student picks between. " +
      "FRQ is open-ended.",
    options: [
      { value: "frq", label: "Free response" },
      { value: "mcq", label: "Multiple choice" },
    ],
  },
];

/**
 * Disclosure-style customize section for the Generate-problems and
 * New-homework modals. Hydrates from localStorage on mount and writes
 * back via the parent's `onChange` so the parent can persist on submit.
 *
 * Yields `params: null` semantics to the parent: when no customization
 * is active (`customizationCount === 0`), the parent should send
 * `params: null` on the API request so the audit log stays clean.
 *
 * Stateless w.r.t. localStorage writes — the parent decides when to
 * persist (typically just before firing the request).
 */
export function GenerationParamsCustomize({
  params,
  onChange,
  disabled,
}: {
  params: GenerationParams;
  onChange: (next: GenerationParams) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PARAMS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<GenerationParams>;
      // Defensive merge: ignore unknown / missing keys by overlaying
      // onto defaults. Stops stale localStorage from breaking the
      // form if we ever change the field set.
      onChange({ ...DEFAULT_GENERATION_PARAMS, ...parsed });
    } catch {
      // Corrupted JSON — stick with defaults.
    }
    // onChange identity changes per render in some parents; we only
    // want to hydrate once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customizationCount = Object.entries(params).filter(
    ([k, v]) => v !== DEFAULT_GENERATION_PARAMS[k as keyof GenerationParams],
  ).length;

  return (
    <div className="rounded-[--radius-md] border border-border-light">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-bold text-text-primary hover:bg-bg-subtle disabled:opacity-50"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span>Customize</span>
          {customizationCount > 0 && (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
              {customizationCount} active
            </span>
          )}
          <span className="font-normal text-text-muted">· optional</span>
        </span>
        <span aria-hidden className="text-text-muted">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="border-t border-border-light p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PARAM_OPTIONS.map(({ key, label, help, options }) => (
              <div key={key}>
                <label
                  htmlFor={`gen-param-${key}`}
                  className="block text-[11px] font-bold uppercase tracking-wide text-text-muted"
                >
                  {label}
                </label>
                <Select
                  id={`gen-param-${key}`}
                  value={params[key]}
                  onChange={(e) =>
                    onChange({
                      ...params,
                      [key]: e.target.value,
                    } as GenerationParams)
                  }
                  disabled={disabled}
                  title={help}
                  className="mt-1 w-full"
                >
                  {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          {customizationCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(DEFAULT_GENERATION_PARAMS)}
              disabled={disabled}
              className="mt-3 text-[11px] text-text-muted hover:text-text-primary disabled:opacity-50"
            >
              Reset to defaults
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Helper used by parents on submit: write the current params to
 *  localStorage and return what to send on the API request
 *  (null when nothing was customized — keeps audit log clean). */
export function persistGenerationParams(
  params: GenerationParams,
): GenerationParams | null {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params));
    }
  } catch {
    // Non-fatal — the modal works without persistence.
  }
  const customized = Object.entries(params).some(
    ([k, v]) => v !== DEFAULT_GENERATION_PARAMS[k as keyof GenerationParams],
  );
  return customized ? params : null;
}
