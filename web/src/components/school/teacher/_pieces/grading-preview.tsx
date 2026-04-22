"use client";

// Plain-English live preview of the grading rubric. Reads the current
// field values (whatever's displayed in the fields, whether saved or
// mid-edit) and renders a bulleted summary of what the AI grader will
// apply. No LLM call — pure derivation.
//
// Sticky on desktop so the teacher sees it adjust as they edit; stacks
// below on mobile. aria-live="polite" announces changes to screen
// readers.

export function GradingPreview({
  fullCredit,
  partialCredit,
  commonMistakes,
  notes,
}: {
  fullCredit: string;
  partialCredit: string;
  commonMistakes: string;
  notes: string;
}) {
  const cm = commonMistakes.trim();
  const n = notes.trim();

  return (
    <aside
      aria-live="polite"
      className="rounded-[--radius-md] border border-border-light bg-bg-subtle/40 p-4 md:sticky md:top-4"
    >
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
        <span aria-hidden>🤖</span>
        How the AI will grade this
      </p>
      <div className="mt-3 space-y-3 text-xs leading-relaxed text-text-primary">
        <PreviewLine
          icon="✓"
          iconClassName="text-green-700 dark:text-green-400"
          heading="Full credit when"
          body={fullCredit}
        />
        <PreviewLine
          icon="◐"
          iconClassName="text-amber-700 dark:text-amber-400"
          heading="Partial credit when"
          body={partialCredit}
        />
        {cm && (
          <PreviewLine
            icon="⚠"
            iconClassName="text-red-700 dark:text-red-400"
            heading="Watch for"
            body={cm}
            muted
          />
        )}
        {n && (
          <PreviewLine
            icon="📝"
            iconClassName="text-text-muted"
            heading="Notes"
            body={n}
            muted
          />
        )}
      </div>
    </aside>
  );
}

function PreviewLine({
  icon,
  iconClassName,
  heading,
  body,
  muted = false,
}: {
  icon: string;
  iconClassName: string;
  heading: string;
  body: string;
  muted?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <span aria-hidden className={`shrink-0 ${iconClassName}`}>
        {icon}
      </span>
      <p className={muted ? "text-text-secondary" : undefined}>
        <span className="font-semibold">{heading}:</span> {body}
      </p>
    </div>
  );
}
