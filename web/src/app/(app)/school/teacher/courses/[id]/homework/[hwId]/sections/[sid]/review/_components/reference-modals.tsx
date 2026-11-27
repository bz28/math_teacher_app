import { useEffect, useRef, useState } from "react";
import type { IntegrityBannerKey } from "../_lib/types";
import { INTEGRITY_STYLE } from "../_lib/integrity-style";

// ── Verdict legend ──────────────────────────────────────────────────
//
// Nine disposition / status states is a lot to learn from icons alone.
// First-time teachers consistently asked "what does ↻ mean vs ⚑?" so
// we surface a small affordance in the roster header that opens a
// keyed reference card. Same icons + colors as the live banner, so
// what the teacher learns here matches what they see on each row.
//
// The labels deliberately drop the implementation jargon (`pass` /
// `tutor_pivot` / `flag_for_review`) — teachers see the meaning, not
// the enum.

const VERDICT_LEGEND_ITEMS: { key: IntegrityBannerKey; description: string }[] = [
  { key: "pass", description: "Student explained their work clearly. Probably did the assignment themselves." },
  { key: "needs_practice", description: "Got the right answer mechanically but couldn't show why it works. Worth revisiting in class." },
  { key: "tutor_pivot", description: "Student got stuck and the AI walked them through it. Their submitted work doesn't reflect what they could do alone." },
  { key: "flag_for_review", description: "Submitted work is correct but the student couldn't explain it. Most likely cheating signal — open the conversation to decide." },
  { key: "needs_review", description: "Check ran but couldn't reach a verdict (e.g. ran out of turns). Manual review recommended." },
  { key: "unfinished", description: "The student didn't finish the check — never confirmed their reading, never answered, or left partway. Not a flag — there's just no understanding signal. Grade their written work; if they never confirmed the reading, it hasn't been AI-graded, so grade it by hand." },
  { key: "skipped_unreadable", description: "Vision couldn't read the student's submission. Grade manually, or have them re-submit." },
  { key: "extracting", description: "Vision is still parsing the student's work. The verdict will arrive shortly." },
  { key: "in_progress", description: "Student is actively chatting with the AI. Verdict pending." },
  { key: "awaiting_student", description: "Student submitted but hasn't started the integrity conversation yet." },
];

export function VerdictLegendTrigger() {
  const [open, setOpen] = useState(false);
  // Capture the trigger so we can restore focus on close — without
  // this, after closing the modal focus jumps to <body> and the
  // teacher loses their place in the page.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-[--radius-sm] px-1.5 py-0.5 text-[11px] font-semibold text-text-muted transition-colors hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label="Show integrity verdict legend"
      >
        <span aria-hidden>ℹ</span>
        <span className="uppercase tracking-wider">Guide</span>
      </button>
      {open && (
        <VerdictLegendModal
          onClose={() => {
            setOpen(false);
            // Defer until after React unmounts the modal so the trigger
            // is back in the document and focusable.
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
        />
      )}
    </>
  );
}

function VerdictLegendModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Escape closes — keyboard parity with the rest of the app's
  // dialogs. Listener lives on document so it fires regardless of
  // current focus inside the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the dialog on open so screen readers announce
  // the title and Tab cycles within the legend's controls. The
  // wrapper has tabIndex={-1} purely to make it focusable.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="verdict-legend-title"
        className="w-full max-w-lg rounded-[--radius-xl] bg-surface p-6 shadow-xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="verdict-legend-title"
              className="text-lg font-bold text-text-primary"
            >
              What the verdicts mean
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              Veradic asks each student to explain a sample of their work after
              they submit. The verdict on each row is what the AI concluded
              from that conversation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-text-muted transition-colors hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span aria-hidden className="text-lg leading-none">×</span>
          </button>
        </div>
        <ul className="mt-4 space-y-3">
          {VERDICT_LEGEND_ITEMS.map(({ key, description }) => {
            const style = INTEGRITY_STYLE[key];
            return (
              <li key={key} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${style.iconBg}`}
                  aria-hidden
                >
                  {style.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-primary">
                    {style.label}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {description}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Keyboard shortcuts cheatsheet ───────────────────────────────────
//
// A small, dismissible reference for the grading keys, opened by "?"
// or the quiet "Press ? for shortcuts" hint. Same modal vocabulary as
// the integrity verdict legend above (Escape-closes, click-outside,
// focus moved into the dialog) so the page has one consistent dialog
// behaviour.

const SHORTCUT_GROUPS: { heading: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    heading: "Grade the focused problem",
    rows: [
      { keys: ["1"], label: "Full credit — 100%" },
      { keys: ["2"], label: "Partial — 75%" },
      { keys: ["3"], label: "Partial — 50%" },
      { keys: ["4"], label: "Partial — 25%" },
      { keys: ["5"], label: "No credit — 0%" },
    ],
  },
  {
    heading: "Confident (collapsed) rows",
    rows: [
      { keys: ["1", "5"], label: "The AI's own key confirms in place + advances" },
    ],
  },
  {
    heading: "Move",
    rows: [
      { keys: ["J", "↓"], label: "Next problem" },
      { keys: ["K", "↑"], label: "Previous problem" },
    ],
  },
  {
    heading: "Students",
    rows: [
      { keys: ["A"], label: "Approve, then open the next student waiting on you" },
      { keys: ["Enter", "→"], label: "Next student" },
    ],
  },
  {
    heading: "The work",
    rows: [{ keys: ["W"], label: "Open the student's pages" }],
  },
  {
    heading: "Help",
    rows: [
      { keys: ["?"], label: "Toggle this cheatsheet" },
      { keys: ["Esc"], label: "Close, or leave a text field" },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-[--radius-sm] border border-border-light bg-[color:var(--color-surface-alt-2)] px-1.5 py-0.5 font-sans text-[11px] font-bold text-text-secondary shadow-sm">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Escape closes — bubble phase, matching the verdict legend. The
  // panel's grading listener bails while this modal is open, so the
  // two never fight over a keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the dialog so SR announces the title and Tab cycles
  // inside; the wrapper has tabIndex={-1} purely to be focusable.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kbd-shortcuts-title"
        className="w-full max-w-md rounded-[--radius-xl] bg-surface p-6 shadow-xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="kbd-shortcuts-title"
              className="text-lg font-bold text-text-primary"
            >
              Keyboard shortcuts
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              Grade without leaving the keyboard — press a number to score the
              highlighted problem, then it advances to the next ungraded one.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-text-muted transition-colors hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span aria-hidden className="text-lg leading-none">×</span>
          </button>
        </div>
        <div className="mt-4 space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.heading}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
                {group.heading}
              </p>
              <ul className="mt-2 space-y-1.5">
                {group.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="text-sm text-text-primary">{row.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-[11px] text-text-muted">or</span>
                          )}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
