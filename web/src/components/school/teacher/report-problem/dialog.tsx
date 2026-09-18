"use client";

import { useId, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { teacher } from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { reportKey, type ReportProblemContext } from "./context";

/**
 * Report kinds. The wire value is what the admin console filters on;
 * the label is the teacher's plain-English reading. The submission set
 * names the three ways the AI can let a teacher down on the review
 * page; the general set is for the sidebar fallback, where nothing is
 * attached and the teacher is telling us about the product itself.
 */
export type ReportKind =
  | "wrong_grade"
  | "misread_work"
  | "understanding_check"
  | "broken"
  | "confusing"
  | "other";

const SUBMISSION_KINDS: { value: ReportKind; label: string }[] = [
  { value: "wrong_grade", label: "The grade or reasoning is wrong" },
  { value: "misread_work", label: "It misread the student's handwriting" },
  { value: "understanding_check", label: "Something's off in the understanding check" },
  { value: "other", label: "Something else" },
];

const GENERAL_KINDS: { value: ReportKind; label: string }[] = [
  { value: "broken", label: "Something's broken" },
  { value: "confusing", label: "Something's confusing or hard to use" },
  { value: "other", label: "Something else" },
];

const NOTE_PLACEHOLDER_SUBMISSION =
  "e.g. The problem says solve by graphing. The student only drew one line and solved with algebra, but still got full credit.";
const NOTE_PLACEHOLDER_GENERAL = "What were you trying to do, and what happened instead?";

export function ReportProblemDialog({
  context,
  onClose,
  onSent,
}: {
  context: ReportProblemContext;
  onClose: () => void;
  onSent: (ctx: ReportProblemContext) => void;
}) {
  const titleId = useId();
  const noteId = useId();
  const onSubmission = !!context.submission_id;
  const kinds = onSubmission ? SUBMISSION_KINDS : GENERAL_KINDS;
  const [kind, setKind] = useState<ReportKind>(kinds[0].value);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAsyncAction();

  const send = () =>
    run(async () => {
      await teacher.reportProblem({
        kind,
        note: note.trim() || null,
        page_url: typeof window === "undefined" ? null : window.location.href,
        submission_id: context.submission_id ?? null,
        assignment_id: context.assignment_id ?? null,
        course_id: context.course_id ?? null,
        section_id: context.section_id ?? null,
        student_id: context.student_id ?? null,
        problem_id: context.problem_id ?? null,
        problem_position: context.problem_position ?? null,
        ai_grade: context.ai_grade ?? null,
        teacher_grade: context.teacher_grade ?? null,
      });
      onSent(context);
      setSent(true);
    }, "Couldn't send your report. Try again in a moment.");

  const title = onSubmission
    ? context.problem_position
      ? "Report a problem with this grade"
      : "Report a problem with this submission"
    : "Report a problem";

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      labelledById={titleId}
      outerClassName="z-[70]"
      className="max-w-lg p-6"
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="font-serif text-2xl leading-tight text-text-primary">
            Thanks — it&rsquo;s on its way
          </h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            Your report went straight to the Veradic team with everything attached.
            {onSubmission && " Your grade stands — reporting never changes it."} We&rsquo;ll
            email you if we need anything else.
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <h2 id={titleId} className="font-serif text-2xl leading-tight text-text-primary">
              {title}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              Goes straight to the Veradic team
              {onSubmission ? " with this submission attached" : ""}.
              {onSubmission && " Nothing here is shown to the student."}
            </p>
          </div>

          {context.labels && context.labels.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Attached to this report">
              {context.labels.map((l) => (
                <li
                  key={l}
                  className="rounded-[--radius-pill] bg-[color:var(--color-surface-alt-2)] px-2.5 py-0.5 text-[11px] font-semibold text-text-secondary"
                >
                  {l}
                </li>
              ))}
            </ul>
          )}

          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-text-secondary">
              What kind of problem?
            </legend>
            {kinds.map((k) => {
              const active = kind === k.value;
              return (
                <label
                  key={k.value}
                  className={`flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-[--radius-md] border px-3 py-2 text-sm transition-colors ${
                    active
                      ? "border-primary bg-primary-bg font-semibold text-text-primary"
                      : "border-border-light font-medium text-text-secondary hover:border-border hover:text-text-primary"
                  }`}
                >
                  <input
                    type="radio"
                    name="report-kind"
                    value={k.value}
                    checked={active}
                    onChange={() => setKind(k.value)}
                    className="m-0 accent-[color:var(--color-primary)]"
                  />
                  {k.label}
                </label>
              );
            })}
          </fieldset>

          <div className="flex flex-col gap-1">
            <label
              htmlFor={noteId}
              className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-secondary"
            >
              What went wrong?{" "}
              <span className="font-normal normal-case tracking-normal text-text-muted">
                · optional, but it helps
              </span>
            </label>
            <textarea
              id={noteId}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={onSubmission ? NOTE_PLACEHOLDER_SUBMISSION : NOTE_PLACEHOLDER_GENERAL}
              className="w-full resize-y rounded-[--radius-sm] border border-border bg-surface px-2.5 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-semibold text-[color:var(--color-error)]">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] leading-snug text-text-muted">
              {onSubmission
                ? "Attached automatically: the student's page, the AI's full reasoning, your grade."
                : "Attached automatically: the page you're on and your account."}
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={send} disabled={busy}>
                {busy ? "Sending…" : "Send report"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Re-exported so mount points can import everything from one place.
export { reportKey };
