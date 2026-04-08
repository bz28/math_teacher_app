"use client";

import { useRef, useState } from "react";
import {
  schoolStudent,
  type StudentHomeworkProblem,
  type SubmitHomeworkResponse,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { cn } from "@/lib/utils";

interface Props {
  assignmentId: string;
  problems: StudentHomeworkProblem[];
  dueAt: string | null;
  /** Called after a successful submit so the parent can swap into
   *  the submitted read-only view. */
  onSubmitted: (resp: SubmitHomeworkResponse) => void;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * The "Submit Homework" section that appears at the bottom of the
 * locked HW page. Per-problem text inputs for final answers + a
 * single image upload of the whole completed homework, plus a Submit
 * button. One-shot — once submitted the parent swaps to <SubmittedView>.
 */
export function SubmissionPanel({
  assignmentId,
  problems,
  dueAt,
  onSubmitted,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageFilename, setImageFilename] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isLate = dueAt ? new Date(dueAt) < new Date() : false;
  const hasAnyAnswer = Object.values(answers).some((v) => v.trim().length > 0);
  const canSubmit = hasAnyAnswer || imageBase64 !== null;

  function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("File must be an image (PNG or JPEG).");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image must be smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // Strip the data: prefix — backend accepts both but raw base64
      // is smaller and matches the personal /work flow.
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      setImageBase64(base64);
      setImageFilename(file.name);
    };
    reader.onerror = () => setError("Couldn't read that file. Try another.");
    reader.readAsDataURL(file);
  }

  async function doSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await schoolStudent.submitHomework(assignmentId, {
        final_answers: Object.fromEntries(
          Object.entries(answers).filter(([, v]) => v.trim().length > 0),
        ),
        image_base64: imageBase64,
      });
      onSubmitted(resp);
    } catch (err) {
      setError((err as Error).message || "Submit failed. Try again.");
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-8 rounded-[--radius-md] border-2 border-dashed border-primary bg-primary-bg/20 p-6">
      <h2 className="text-lg font-bold text-text-primary">Submit your homework</h2>
      <p className="mt-1 text-sm text-text-secondary">
        Type your final answers below and upload a picture of your completed work. Both are
        optional individually, but you need at least one.
      </p>

      {isLate && (
        <div className="mt-4 rounded-[--radius-sm] border border-amber-500 bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10">
          ⚠ This homework is past due. You can still submit, but it will be marked late.
        </div>
      )}

      <div className="mt-6 space-y-3">
        {problems.map((p) => (
          <div key={p.bank_item_id}>
            <label className="flex items-start gap-3">
              <span className="mt-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                {p.position}
              </span>
              <div className="flex-1">
                <div className="text-xs text-text-muted">
                  <MathText text={p.question} />
                </div>
                <input
                  type="text"
                  value={answers[p.bank_item_id] || ""}
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [p.bank_item_id]: e.target.value }))
                  }
                  placeholder="Your final answer"
                  className="mt-1 w-full rounded-[--radius-sm] border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
                />
              </div>
            </label>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <div className="text-sm font-semibold text-text-primary">Upload your work</div>
        <p className="text-xs text-text-muted">
          One picture of your full completed homework. PNG or JPEG, under 5 MB.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="mt-2 block w-full text-sm text-text-secondary file:mr-3 file:rounded-[--radius-sm] file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-white hover:file:bg-primary/90"
        />
        {imageFilename && (
          <div className="mt-2 text-xs text-green-600">✓ {imageFilename} attached</div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-error">{error}</p>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        {confirming ? (
          <>
            <span className="text-sm text-text-secondary">Submit homework? You can&apos;t edit after this.</span>
            <button
              onClick={() => setConfirming(false)}
              disabled={submitting}
              className="rounded-[--radius-sm] border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:border-primary disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={doSubmit}
              disabled={submitting}
              className="rounded-[--radius-sm] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Yes, submit"}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={!canSubmit}
            className={cn(
              "rounded-[--radius-sm] px-5 py-2 text-sm font-bold text-white disabled:opacity-50",
              isLate ? "bg-amber-600 hover:bg-amber-700" : "bg-primary hover:bg-primary/90",
            )}
          >
            Submit homework{isLate ? " (late)" : ""}
          </button>
        )}
      </div>
    </div>
  );
}
