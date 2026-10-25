"use client";

import { useEffect, useRef, useState } from "react";
import { teacher, type RubricSuggestion } from "@/lib/api";

type Done = "added" | "added_homework" | "declined";

const DONE_COPY: Record<Done, string> = {
  added: "Added to your class rubric. The AI applies it from now on.",
  added_homework: "Added to this homework's extra rules.",
  declined: "Got it — we won't suggest this rule again. You can still add it from class settings.",
};

/**
 * "Want the AI to grade this way next time?" — shown under a problem the
 * teacher just graded LOWER than the AI and explained. The server decides
 * whether the comment is a standing rule worth offering (and remembers
 * what this class declined); this only asks once per grade+comment and
 * renders the answer. Never blocks grading: ignoring it is fine and isn't
 * a "no".
 */
export function RuleSuggestion({
  submissionId,
  problemId,
  aiPercent,
  teacherPercent,
  comment,
  aiFeedback,
}: {
  submissionId: string;
  problemId: string;
  /** The AI's grade for this problem; null when it never graded it. */
  aiPercent: number | null;
  /** The teacher's current grade; null until they've graded. */
  teacherPercent: number | null;
  /** The teacher's current feedback for this problem. */
  comment: string;
  /** The AI's own drafted feedback — a comment equal to it is not the
   *  teacher's reason. */
  aiFeedback: string | null;
}) {
  const [offer, setOffer] = useState<RubricSuggestion | null>(null);
  const [mode, setMode] = useState<"offer" | "edit">("offer");
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [points, setPoints] = useState("");
  // One ask per (grade, comment): re-renders and unrelated edits don't
  // re-ask, but a new reason for a new grade does.
  const asked = useRef(new Set<string>());

  const trimmed = comment.trim();
  const qualifies =
    aiPercent !== null &&
    teacherPercent !== null &&
    teacherPercent < aiPercent &&
    trimmed.length > 0 &&
    trimmed !== (aiFeedback ?? "").trim();

  useEffect(() => {
    if (!qualifies || offer || done) return;
    const key = `${teacherPercent}|${trimmed}`;
    if (asked.current.has(key)) return;
    // Settle first: the grade and comment save on their own; this waits
    // out a burst of edits so it asks about the final one.
    const timer = setTimeout(() => {
      asked.current.add(key);
      teacher
        .suggestRubricRule(submissionId, {
          problem_id: problemId,
          teacher_percent: teacherPercent as number,
          comment: trimmed,
        })
        .then((res) => {
          if (!res.suggestion) return;
          setOffer(res.suggestion);
          setText(res.suggestion.text);
          setPoints(res.suggestion.points === null ? "" : String(res.suggestion.points));
        })
        .catch(() => {
          /* no offer is fine — grading carries on */
        });
    }, 700);
    return () => clearTimeout(timer);
  }, [qualifies, offer, done, teacherPercent, trimmed, submissionId, problemId]);

  if (done) {
    return (
      <p role="status" className="mt-3 text-xs text-text-secondary">
        {DONE_COPY[done]}
      </p>
    );
  }
  if (!offer) return null;

  const answer = async (action: "add_class" | "add_homework" | "decline") => {
    let body: Parameters<typeof teacher.decideRubricSuggestion>[1] = { action };
    if (mode === "edit" && action !== "decline") {
      const t = text.trim();
      const p = points.trim();
      const n = p ? Number(p) : null;
      if (!t) return setError("Write the rule first.");
      if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 100)) {
        return setError("Points must be a whole number from 0 to 100.");
      }
      body = { action, text: t, points: n };
    }
    setBusy(true);
    setError(null);
    try {
      await teacher.decideRubricSuggestion(offer.id, body);
      setDone(action === "add_class" ? "added" : action === "add_homework" ? "added_homework" : "declined");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const btn = "min-h-10 rounded-[--radius-md] px-3 text-[13px] font-semibold disabled:opacity-50";
  const textId = `suggest-${offer.id}-text`;
  const pointsId = `suggest-${offer.id}-points`;

  return (
    <section
      aria-label="Suggested rubric rule"
      className="mt-3 rounded-[--radius-md] border border-primary/25 bg-[color:var(--color-primary-bg)] p-3"
    >
      <p className="text-[13px] leading-snug text-text-primary">
        <strong className="font-semibold">Want the AI to grade this way next time?</strong>{" "}
        Your comment sounds like a rule for the whole class.
      </p>

      {mode === "offer" ? (
        <p className="mt-2 rounded-[--radius-sm] bg-surface px-3 py-2 text-[13px] text-text-primary">
          {offer.text}
          {offer.points !== null && (
            <span className="ml-1.5 font-mono text-xs font-semibold text-[color:var(--color-error)]">
              −{offer.points}
            </span>
          )}
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <label htmlFor={textId} className="sr-only">Rule</label>
          <input
            id={textId}
            type="text"
            autoFocus
            maxLength={300}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-[13px] text-text-primary focus:border-primary focus:outline-none"
          />
          <label htmlFor={pointsId} className="sr-only">Points off</label>
          <input
            id={pointsId}
            type="text"
            inputMode="numeric"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder="Pts"
            className="w-full rounded-[--radius-md] border border-border-light bg-surface px-3 py-2 text-[13px] text-text-primary focus:border-primary focus:outline-none sm:w-20"
          />
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-[color:var(--color-error)]">{error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer("add_class")}
          className={`${btn} bg-primary text-white hover:bg-primary-dark`}
        >
          Add to class rubric
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer("add_homework")}
          className={`${btn} text-primary hover:bg-surface`}
        >
          Just this homework
        </button>
        {mode === "offer" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("edit")}
            className={`${btn} text-primary hover:bg-surface`}
          >
            Edit first
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer("decline")}
          className={`${btn} ml-auto text-text-secondary hover:text-text-primary`}
        >
          No thanks
        </button>
      </div>
    </section>
  );
}
