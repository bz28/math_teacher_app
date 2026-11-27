"use client";

import { useEffect, useRef } from "react";
import { formatDue } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LATE_POLICY_OPTIONS } from "./assignment-wizard-steps";

// The New Homework wizard's frame: its discard prompt, stepper, problem
// source tabs and review summary.

export type Mode = "generate" | "upload";

// ── Discard-unsaved-work confirm ──
//
// A stacked alert that fronts a dismiss attempt on a dirty wizard, so a
// stray Escape / backdrop click can't silently throw away a homework the
// teacher spent minutes composing. Self-contained: it owns its own
// Escape-to-cancel and a Tab focus-trap (capture phase so it beats the
// wizard's document listener), and it never touches the wizard state
// beyond the two callbacks. The wizard is held non-dismissible while this
// is open, so the two dismiss layers never fight.
export function DiscardConfirmDialog({
  onKeepEditing,
  onDiscard,
}: {
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Move focus into the prompt on open, landing on the safe default
  // ("Keep editing") so an accidental Enter can't discard the work. On
  // close we restore focus to whatever the teacher was on (the field they
  // Escaped from, or the ✕ they clicked) — the standard dialog contract.
  // On Discard the whole wizard unmounts and its own hook restores the
  // pre-wizard focus, so this restore harmlessly no-ops there.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("button");
    first?.focus();
    return () => trigger?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onKeepEditing();
        return;
      }
      if (e.key === "Tab" && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>("button");
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // Capture phase: run before the wizard's bubble-phase keydown handler
    // so our Escape/Tab wins while the prompt is up.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onKeepEditing]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[color:var(--color-overlay)] p-4 backdrop-blur-sm"
      onClick={onKeepEditing}
    >
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hw-discard-title"
        aria-describedby="hw-discard-body"
        className="w-full max-w-sm rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="hw-discard-title"
          className="font-serif text-lg leading-tight tracking-[-0.01em] text-text-primary"
        >
          Discard this homework?
        </h2>
        <p id="hw-discard-body" className="mt-2 text-sm text-text-secondary">
          Your problems and settings will be lost.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button variant="danger" size="sm" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Stepper ──

export function WizardStepper<S extends number>({
  steps,
  step,
  onJump,
}: {
  steps: readonly { n: S; label: string }[];
  step: S;
  onJump: (n: S) => void;
}) {
  return (
    <ol className="flex items-center">
      {steps.map((s, i) => {
        const state =
          s.n < step ? "done" : s.n === step ? "current" : "upcoming";
        // Only completed steps are clickable — forward jumps must pass
        // the Details validation gate.
        const clickable = s.n < step;
        return (
          <li key={s.n} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => clickable && onJump(s.n)}
              disabled={!clickable}
              aria-current={state === "current" ? "step" : undefined}
              className={`group flex items-center gap-2 ${
                clickable ? "cursor-pointer" : "cursor-default"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  state === "current"
                    ? "bg-primary text-white"
                    : state === "done"
                      ? "border border-primary/40 bg-primary/10 text-primary group-hover:bg-primary/20"
                      : "border border-border-light bg-surface text-text-muted"
                }`}
              >
                {state === "done" ? "✓" : s.n}
              </span>
              <span
                className={`hidden text-[11px] font-semibold uppercase tracking-[0.12em] sm:inline ${
                  state === "upcoming" ? "text-text-muted" : "text-text-primary"
                }`}
              >
                {s.label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={`mx-2 h-px flex-1 ${
                  s.n < step ? "bg-primary/40" : "bg-border-light"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Generate / Upload mode toggle ──

export function ModeTabs({
  mode,
  onChange,
  disabled,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  disabled: boolean;
}) {
  const tabs: { key: Mode; label: string }[] = [
    { key: "generate", label: "Generate" },
    { key: "upload", label: "Upload" },
  ];
  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + tabs.length) % tabs.length;
    onChange(tabs[next].key);
  };
  return (
    <div role="tablist" aria-label="Homework problem source" className="flex gap-1.5">
      {tabs.map((t, i) => {
        const selected = mode === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
              selected
                ? "bg-primary text-white"
                : "bg-bg-subtle text-text-primary hover:bg-bg-base"
            } disabled:opacity-50`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Review step ──

export function ReviewStep({
  title,
  unitNames,
  unitCount,
  dueAt,
  latePolicy,
  sectionCount,
  mode,
  count,
  fileCount,
  hasRubric,
  totalPoints,
}: {
  title: string;
  unitNames: string[];
  unitCount: number;
  dueAt: string;
  latePolicy: string;
  sectionCount: number;
  mode: Mode;
  count: number;
  fileCount: number;
  hasRubric: boolean;
  totalPoints: number;
}) {
  const lateLabel =
    LATE_POLICY_OPTIONS.find((o) => o.value === latePolicy)?.label ?? latePolicy;
  const unitsText =
    unitNames.length > 0
      ? unitNames.join(", ")
      : `${unitCount} unit${unitCount === 1 ? "" : "s"}`;
  const problemsText =
    mode === "generate"
      ? `Generate ${count} problem${count === 1 ? "" : "s"} with AI`
      : fileCount > 0
        ? `Extract from ${fileCount} uploaded page${fileCount === 1 ? "" : "s"}`
        : "No pages added yet";

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-muted">
        One last look. Creating sets the due date, sections, late policy and
        grading rubric in one go — then the AI&apos;s problems land in a review
        queue, where you approve them and publish.
      </p>

      <dl className="overflow-hidden rounded-[--radius-md] border border-border-light">
        <SummaryRow label="Title" value={title.trim() || "Untitled"} />
        <SummaryRow label="Units" value={unitsText} />
        <SummaryRow
          label="Due"
          value={dueAt ? formatDue(new Date(dueAt).toISOString()) : "No due date"}
          muted={!dueAt}
        />
        <SummaryRow label="Late policy" value={lateLabel} />
        <SummaryRow
          label="Sections"
          value={
            sectionCount === 0
              ? "All sections in this course"
              : `${sectionCount} section${sectionCount === 1 ? "" : "s"}`
          }
          muted={sectionCount === 0}
        />
        <SummaryRow label="Problems" value={problemsText} muted={mode === "upload" && fileCount === 0} />
        <SummaryRow label="Points" value={`${totalPoints}, split evenly`} />
        <SummaryRow
          label="Grading"
          value={hasRubric ? "Class rules + rules for this homework" : "Class rules"}
          muted={!hasRubric}
          last
        />
      </dl>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted,
  last,
}: {
  label: string;
  value: string;
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-4 px-4 py-2.5 ${
        last ? "" : "border-b border-border-light"
      }`}
    >
      <dt className="w-28 shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
        {label}
      </dt>
      <dd
        className={`min-w-0 flex-1 text-sm ${
          muted ? "italic text-text-muted" : "text-text-primary"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
