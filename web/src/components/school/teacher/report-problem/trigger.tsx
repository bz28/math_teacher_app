"use client";

import { reportKey, useReportProblem, type ReportProblemContext } from "./context";

function FlagIcon({ className, size = 13 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M4 22V4" />
      <path d="M4 4h14l-2 5 2 5H4" />
    </svg>
  );
}

/**
 * The one "Report a problem" trigger, mounted wherever the AI made a call
 * a teacher might disagree with. Quiet by default — a muted flag + label
 * — so it never competes with the grade buttons, and it flips to a green
 * "Reported" pill once sent so the teacher knows it landed. `label`
 * lets the header use the shorter icon-only form.
 */
export function ReportProblemTrigger({
  context,
  label = "Report a problem",
  iconOnly = false,
  variant = "quiet",
  className = "",
}: {
  context: ReportProblemContext;
  label?: string;
  iconOnly?: boolean;
  /** `quiet` — the small inline link next to an AI verdict. `nav` — a
   *  sidebar row styled like its neighbours (Take the tour). */
  variant?: "quiet" | "nav";
  className?: string;
}) {
  const { openReport, reported } = useReportProblem();
  const done = reported.has(reportKey(context));

  if (variant === "nav") {
    return (
      <button
        type="button"
        onClick={() => openReport(context)}
        className={`flex w-full items-center gap-3 px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary ${className}`}
      >
        <FlagIcon size={18} />
        {label}
      </button>
    );
  }

  if (done) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-[--radius-pill] border border-[color:var(--color-success-border)] bg-[color:var(--color-success-light)] px-2 py-0.5 text-[11px] font-bold text-[color:var(--color-success)] ${className}`}
        title="Reported — the Veradic team is looking into it"
      >
        <span aria-hidden>✓</span>
        {iconOnly ? <span className="sr-only">Reported</span> : "Reported"}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openReport(context)}
      title={label}
      aria-label={iconOnly ? label : undefined}
      className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-[--radius-sm] px-1.5 py-0.5 text-[11px] font-semibold text-text-muted transition-colors hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className}`}
    >
      <FlagIcon />
      {!iconOnly && label}
    </button>
  );
}
