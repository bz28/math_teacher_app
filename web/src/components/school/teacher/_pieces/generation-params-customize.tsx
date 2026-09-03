"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_GENERATION_PARAMS,
  type GenerationParams,
} from "@/lib/api";
import { Select } from "@/components/ui";
import {
  PARAM_OPTIONS,
  activeSummary,
} from "./generation-params-options";

// localStorage key for the Customize-section selections. Per-teacher
// scoping happens implicitly because each teacher logs in on their
// own browser session; cross-teacher leakage on a shared device is
// the same risk every other form has and is out of scope.
const PARAMS_STORAGE_KEY = "veradic.generationParams";

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
        className="flex w-full items-start justify-between px-3 py-2 text-left text-sm font-bold text-text-primary hover:bg-bg-subtle disabled:opacity-50"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span>Customize</span>
            {customizationCount > 0 && (
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
                {customizationCount} active
              </span>
            )}
            {customizationCount === 0 && (
              <span className="font-normal text-text-muted">· optional</span>
            )}
          </span>
          {/* One line, two jobs. Closed and untouched it says what the
              section is FOR — otherwise "Customize" names a verb and a
              teacher has to open it to discover the feature exists. Closed
              with settings applied it says WHICH, which matters more than
              it looks: these params hydrate from localStorage on mount, so
              a choice made weeks ago silently shapes today's generation and
              the count badge alone ("2 active") never says what changed.
              Deliberately inside the button — it lengthens the accessible
              name, but hiding it would keep the applied settings from
              exactly the users least able to spot them another way. */}
          {/* Closed only. Open, the dropdowns below ARE the answer — a
              summary line repeating "Whole numbers · All hard" directly
              above the two selects showing exactly that is duplicated
              state a reader has to reconcile. */}
          {!open && (
            <span className="mt-0.5 block truncate text-[11px] font-normal text-text-muted">
              {customizationCount > 0
                ? activeSummary(params, DEFAULT_GENERATION_PARAMS)
                : "AI picks difficulty, answer form and format — set any of them yourself here."}
            </span>
          )}
        </span>
        <span aria-hidden className="ml-2 shrink-0 text-text-muted">
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
