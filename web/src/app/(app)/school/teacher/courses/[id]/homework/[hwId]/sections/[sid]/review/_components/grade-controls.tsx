import type { ReactNode } from "react";
import type { GradeStatus } from "../_lib/types";

// ────────────────────────────────────────────────────────────────────
// The Full / Partial / No credit picker on an expanded problem row.
// Partial opens an inline percent input; Enter or blur commits it.
// The row owns the draft and the commit; this file only draws them.
// ────────────────────────────────────────────────────────────────────

export function GradeControls({
  current,
  aiStatus,
  onFull,
  onPartial,
  onZero,
  partialInputRef,
  partialDraft,
  onPartialDraft,
  onPartialCommit,
  earnedLabel,
}: {
  current: GradeStatus | null;
  aiStatus: GradeStatus | null;
  onFull: () => void;
  onPartial: () => void;
  onZero: () => void;
  partialInputRef: (el: HTMLInputElement | null) => void;
  partialDraft: string;
  onPartialDraft: (value: string) => void;
  onPartialCommit: () => void;
  /** "6.5/13 pts" for the current partial grade, or null before one exists. */
  earnedLabel: string | null;
}) {
  // The three choices sit together and the partial percent comes after
  // them: with the percent chip between Partial and No credit, a row at a
  // laptop width wrapped No credit onto a line of its own.
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <GradeBtn
        active={current === "full"}
        tone="green"
        onClick={onFull}
        aiPick={aiStatus === "full"}
      >
        Full
      </GradeBtn>
      <GradeBtn
        active={current === "partial"}
        tone="amber"
        onClick={onPartial}
        aiPick={aiStatus === "partial"}
      >
        Partial
      </GradeBtn>
      <GradeBtn
        active={current === "zero"}
        tone="red"
        onClick={onZero}
        aiPick={aiStatus === "zero"}
      >
        No credit
      </GradeBtn>
      {current === "partial" && (
        <div className="inline-flex items-center gap-1 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-2 py-1 text-xs font-semibold text-[color:var(--color-warning-dark)]  dark:bg-[color:var(--color-warning)]/10 ">
          <input
            ref={partialInputRef}
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={partialDraft}
            onChange={(e) => onPartialDraft(e.target.value)}
            onBlur={onPartialCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label="Partial credit percent (1-99)"
            className="w-12 bg-transparent text-right tabular-nums focus:outline-none"
          />
          <span aria-hidden>%</span>
          {earnedLabel && (
            <span className="ml-1 font-normal text-[color:var(--color-warning-dark)]/80">
              · {earnedLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function GradeBtn({
  active,
  tone,
  onClick,
  children,
  aiPick = false,
}: {
  active: boolean;
  tone: "green" | "amber" | "red";
  onClick: () => void;
  children: ReactNode;
  /** Mark this button as the AI's suggestion. When not the active
   *  choice, a subtle primary-tinted outline signals "the AI
   *  recommended this". Always pairs with an inline "AI" pill. */
  aiPick?: boolean;
}) {
  // Selected fills carry a white label, so each one is picked to clear
  // 4.5:1 under white. None of the three did:
  //   red   → `--color-error-light` (#F0D7D1, a pale pink) at 1.37:1 —
  //           the label all but vanished the moment a teacher picked it
  //   green → Tailwind's green-500, outside the palette, at 2.2:1
  //   amber → `--color-warning` (#A66B15) at 4.43:1, just under
  // Amber is why this list is `-dark` for one tone and not the others:
  // `--color-warning` is the lightest of the three status tokens and
  // misses on its own, so the filled-with-white use takes
  // `--color-warning-dark` (6.08:1). Red and green clear it at full
  // strength (9.00:1 and 6.08:1). Check the ratio before adding a tone.
  //
  // These are LIGHT-theme ratios, which is what ships: nothing in the app
  // sets `data-theme`, and there is no `prefers-color-scheme` block, so
  // the dark token block in globals.css is currently unreachable. Under
  // those tokens white would sit at 4.19 (error), 3.15 (success) and 3.14
  // (warning) — all under AA. Fixing that is not a token swap: it needs a
  // dark-theme foreground decision (dark ink on the lighter fills) taken
  // across the app rather than guessed at here, so it is deliberately not
  // done in this file. Whoever turns dark mode on owns it.
  const activeCls = {
    green: "border-[color:var(--color-success)] bg-[color:var(--color-success)] text-white",
    amber: "border-[color:var(--color-warning-dark)] bg-[color:var(--color-warning-dark)] text-white",
    red: "border-[color:var(--color-error)] bg-[color:var(--color-error)] text-white",
  }[tone];
  const inactiveCls = aiPick
    ? "border-primary/40 bg-primary-bg text-text-primary hover:border-primary/60"
    : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[36px] items-center gap-1 rounded-[--radius-md] border px-3.5 py-2 text-xs font-bold transition-colors ${
        active ? activeCls : inactiveCls
      }`}
    >
      {children}
      {aiPick && (
        <span
          className={`rounded-[--radius-pill] px-1.5 py-0.5 text-[10px] font-bold leading-none ${
            active ? "bg-white/30 text-white" : "bg-primary/15 text-primary"
          }`}
          aria-label="AI suggestion"
        >
          AI
        </span>
      )}
    </button>
  );
}
