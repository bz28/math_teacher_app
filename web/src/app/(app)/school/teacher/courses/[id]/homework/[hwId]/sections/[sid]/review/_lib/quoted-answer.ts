import type {
  IntegrityActivityReason,
  TeacherIntegrityDetail,
  TeacherIntegrityTranscriptTurn,
} from "@/lib/api";

export type QuotedAnswer = {
  /** The AI question this answer replied to, so a terse "idk" reads in
   *  context. Null when no AI turn came before it. */
  question: string | null;
  turn: TeacherIntegrityTranscriptTurn;
  /** Why this answer was picked over the last one (a paste, a long
   *  tab-out). Null when it is simply the student's last answer. */
  reason: IntegrityActivityReason | null;
};

/** The student's most telling answer for the integrity card: the latest
 *  one the activity rollup marked notable, else their last one. Null
 *  when the student never answered. Reads only the detail the card
 *  already has — no fetch. */
export function quotedAnswer(
  d: Pick<TeacherIntegrityDetail, "transcript" | "activity_summary">,
): QuotedAnswer | null {
  const answers = d.transcript.filter(
    (t) => t.role === "student" && t.content.trim() !== "",
  );
  if (answers.length === 0) return null;
  const notable = new Map(
    (d.activity_summary?.notable_turns ?? []).map((n) => [n.ordinal, n]),
  );
  let turn = answers[answers.length - 1];
  let reason: IntegrityActivityReason | null = null;
  for (let i = answers.length - 1; i >= 0; i--) {
    const n = notable.get(answers[i].ordinal);
    // Telemetry is what the reason's copy is computed from; a notable
    // ordinal without it would read "pasted 0 chars", so skip it.
    if (n && n.reasons.length > 0 && answers[i].telemetry) {
      turn = answers[i];
      reason = n.reasons[0];
      break;
    }
  }
  const question =
    d.transcript
      .filter((t) => t.role === "agent" && t.ordinal < turn.ordinal)
      .at(-1)?.content ?? null;
  return { question, turn, reason };
}
