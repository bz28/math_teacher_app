"use client";

/**
 * Terminal screen shown after the student flagged the extraction as
 * wrong. No AI grading or integrity chat ran — the submission is
 * already in the teacher's inbox for manual grading, with the student's
 * note and any lines they fixed. Student has nothing else to do.
 */
export function ExtractionFlaggedTerminalView() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <div className="mx-auto mb-4 text-4xl" aria-hidden>
        ✉️
      </div>
      <h1 className="text-2xl font-bold text-text-primary">
        Sent to your teacher
      </h1>
      <p className="mt-3 text-sm text-text-secondary">
        You said we misread most of your work, so your teacher will grade
        it from your photos. Anything you told us or fixed went along too.
      </p>
      <p className="mt-4 text-xs text-text-muted">
        Nothing else to do — your teacher will follow up with a grade
        when they&rsquo;ve reviewed it.
      </p>
    </div>
  );
}
