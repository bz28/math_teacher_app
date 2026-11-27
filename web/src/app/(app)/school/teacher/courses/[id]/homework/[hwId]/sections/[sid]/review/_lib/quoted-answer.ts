import type {
  IntegrityActivityReason,
  TeacherIntegrityDetail,
  TeacherIntegrityTranscriptTurn,
} from "@/lib/api";

type Detail = Pick<TeacherIntegrityDetail, "transcript" | "activity_summary">;

export type QuotedAnswer = {
  /** The AI question this answer replied to, so a terse "idk" reads in
   *  context. Null when no AI turn came before it. */
  question: string | null;
  turn: TeacherIntegrityTranscriptTurn;
  /** Why the activity rollup marked this answer (a paste, a tab-out);
   *  empty when it didn't. Shown on the quote, since the evidence
   *  disclosure leaves this turn out rather than repeat it. */
  reasons: IntegrityActivityReason[];
};

export type FlaggedTurn = {
  turn: TeacherIntegrityTranscriptTurn;
  reasons: IntegrityActivityReason[];
};

// A marked ordinal without telemetry is skipped: the reason copy is
// computed from it and would read "pasted 0 chars".
function markedReasons(d: Detail): Map<number, IntegrityActivityReason[]> {
  const out = new Map<number, IntegrityActivityReason[]>();
  for (const n of d.activity_summary?.notable_turns ?? []) {
    if (n.reasons.length > 0) out.set(n.ordinal, n.reasons);
  }
  for (const t of d.transcript) {
    if (out.has(t.ordinal) && (t.role !== "student" || !t.telemetry)) {
      out.delete(t.ordinal);
    }
  }
  return out;
}

function answers(d: Detail): TeacherIntegrityTranscriptTurn[] {
  return d.transcript.filter(
    (t) => t.role === "student" && t.content.trim() !== "",
  );
}

/** The student's last answer, which the integrity card quotes, with the
 *  AI question it replied to. Null when the student never answered.
 *  Reads only the detail the card already has — no fetch. */
export function quotedAnswer(d: Detail): QuotedAnswer | null {
  const all = answers(d);
  if (all.length === 0) return null;
  const turn = all[all.length - 1];
  const question =
    d.transcript
      .filter((t) => t.role === "agent" && t.ordinal < turn.ordinal)
      .at(-1)?.content ?? null;
  return { question, turn, reasons: markedReasons(d).get(turn.ordinal) ?? [] };
}

/** The answers the activity rollup marked (a paste, a long tab-out), in
 *  conversation order — the evidence behind an activity flag, which the
 *  card shows collapsed. Leaves out the last answer: the card already
 *  quotes it, with its reasons. */
export function flaggedTurns(d: Detail): FlaggedTurn[] {
  const marked = markedReasons(d);
  const all = answers(d);
  return all.slice(0, -1).flatMap((turn) => {
    const reasons = marked.get(turn.ordinal);
    return reasons ? [{ turn, reasons }] : [];
  });
}
