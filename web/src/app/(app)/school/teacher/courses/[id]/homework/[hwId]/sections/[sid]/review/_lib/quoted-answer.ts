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
};

export type FlaggedTurn = {
  turn: TeacherIntegrityTranscriptTurn;
  reasons: IntegrityActivityReason[];
};

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
  return { question, turn };
}

/** The answers the activity rollup marked (a paste, a long tab-out), in
 *  conversation order — the evidence behind an activity flag, which the
 *  card shows collapsed. A marked ordinal without telemetry is skipped:
 *  the reason copy is computed from it and would read "pasted 0 chars". */
export function flaggedTurns(d: Detail): FlaggedTurn[] {
  const notable = new Map(
    (d.activity_summary?.notable_turns ?? []).map((n) => [n.ordinal, n]),
  );
  return answers(d).flatMap((turn) => {
    const n = notable.get(turn.ordinal);
    return n && n.reasons.length > 0 && turn.telemetry
      ? [{ turn, reasons: n.reasons }]
      : [];
  });
}
