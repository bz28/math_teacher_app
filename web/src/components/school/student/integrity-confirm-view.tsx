"use client";

import { useState } from "react";
import {
  schoolStudent,
  type IntegrityExtraction,
} from "@/lib/api";
import { ExtractionView } from "@/components/school/shared/extraction-view";
import { useDeviceType } from "./use-device-type";

interface Props {
  submissionId: string;
  /** Full data-URL of the submitted work, rendered alongside the
   *  extraction so the student can eyeball "is that really what I
   *  wrote?" before the agent starts probing. The parent guarantees
   *  this is present before routing into this view — if the photo
   *  fetch failed, the confirm screen is skipped entirely and the
   *  student goes straight to chat. */
  submittedImageDataUrl: string;
  extraction: IntegrityExtraction;
  /** Student confirmed the reader got it right. Parent transitions
   *  to the chat. */
  onContinue: () => void;
  /** Student said the reader got something wrong. We fire the flag
   *  endpoint here and then hand control back to the parent, which
   *  transitions to the chat anyway — the flag is a signal for the
   *  teacher, not a gate. */
  onFlagged: () => void;
}

/**
 * Post-extraction confirmation screen. Shown once, between
 * "awaiting_student" and the first chat turn. Gives the student a
 * chance to verify that Vision read their work correctly before
 * committing to the agent's questions.
 *
 * Read-only — the student can flag but not edit. Editing would let
 * them rewrite their own work to dodge follow-ups.
 */
// Soft time budget matches the chat header. Mobile typing is ~2x
// slower, so mobile students see a longer expectation.
const BUDGET_COPY: Record<"desktop" | "mobile", string> = {
  desktop: "Takes about 3 minutes.",
  mobile: "Takes about 5 minutes.",
};

export function IntegrityConfirmView({
  submissionId,
  submittedImageDataUrl,
  extraction,
  onContinue,
  onFlagged,
}: Props) {
  const [flagging, setFlagging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const device = useDeviceType();

  async function handleFlag() {
    setFlagging(true);
    setError(null);
    try {
      await schoolStudent.flagIntegrityExtraction(submissionId);
      onFlagged();
    } catch {
      setError("Couldn't save your flag. Try again.");
      setFlagging(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-text-primary">
        Here&rsquo;s what we read from your work
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        Before we chat about your homework, take a quick look — does this
        match what you wrote? If anything&rsquo;s off, let us know so your
        teacher knows too.
      </p>

      {/* Upfront rules — stated once, before the chat starts. Makes
          behavioral signals meaningful by setting the expectation,
          not ambushing the student after. */}
      <div className="mt-4 rounded-[--radius-sm] border border-border-light bg-bg-subtle px-4 py-3 text-sm text-text-secondary">
        <span className="font-semibold text-text-primary">Quick check-in:</span>{" "}
        Stay in this window and answer in your own words. You don&rsquo;t need
        to look anything up. {BUDGET_COPY[device]}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
            Your photo
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={submittedImageDataUrl}
            alt="Your submitted homework"
            className="mt-2 max-h-[520px] w-full rounded-[--radius-md] border border-border bg-surface object-contain"
          />
        </div>

        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-text-muted">
            What we read
          </div>
          <div className="mt-2">
            <ExtractionView extraction={extraction} variant="full" />
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={handleFlag}
          disabled={flagging}
          className="w-full rounded-[--radius-sm] border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 sm:w-auto"
        >
          {flagging ? "Saving…" : "Reader got something wrong"}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={flagging}
          className="w-full rounded-[--radius-sm] bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50 sm:w-auto"
        >
          Looks right — continue
        </button>
      </div>
    </div>
  );
}
