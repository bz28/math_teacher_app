import { useId, useMemo, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import { Modal } from "@/components/ui/modal";
import {
  ActivityDigest,
  ActivityTurnMarker,
  formatMs,
  integrityNeedsResolution,
  ResolveIntegrityControl,
  UNFINISHED_CHECK_COPY,
  type IntegrityActivityNotableTurnLite,
} from "@/components/school/teacher/_pieces/integrity-pieces";
import type {
  IntegrityResolutionOutcome,
  TeacherIntegrityDetail,
  TeacherIntegrityTranscriptTurn,
  UnfinishedCheck,
  TeacherSubmissionRow,
} from "@/lib/api";
import type { IntegrityBannerKey } from "../_lib/types";
import { NEUTRAL_STYLE, INTEGRITY_STYLE } from "../_lib/integrity-style";

/**
 * Compact integrity verdict card. Collapsed by default: verdict icon +
 * headline, the activity flags as chips, and a footer with the Details
 * toggle, "Conversation ↗", and — on an open flag — "Mark reviewed" as
 * the one primary action. Details holds the AI summary, the activity
 * digest, and (once resolved) the resolution chip with Change.
 *
 * Lives at the top of the pinned right rail on xl, and in the grade
 * column below xl, so the verdict no longer pushes PROBLEMS down the
 * page. Open/closed is a session preference lifted to the page so it
 * persists across students. When the full `TeacherIntegrityDetail`
 * hasn't loaded yet, falls back to the overview on the submission row
 * so the teacher still sees the verdict/in-progress state during the
 * brief fetch gap. Hides entirely when there's no integrity signal.
 */
export function IntegrityCard({
  integrity,
  overviewFallback,
  unfinished,
  onResolved,
  detailsOpen,
  onToggleDetails,
}: {
  integrity: TeacherIntegrityDetail | null;
  overviewFallback: TeacherSubmissionRow["integrity_overview"] | null;
  /** The row's "didn't finish" state. Wins over the status switch below,
   *  and is the only signal for a never-confirmed reading (no check row
   *  exists, so `integrity` comes back "no_check"). */
  unfinished: UnfinishedCheck | null;
  onResolved: (
    submissionId: string,
    resolution: IntegrityResolutionOutcome,
  ) => void;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  // Prefer full detail. If it's missing (fetch pending / 404), use
  // the overview so the disposition signal still surfaces without
  // waiting for a second round-trip.
  const disposition =
    integrity?.disposition ?? overviewFallback?.disposition ?? null;
  const summary = integrity?.overall_summary ?? null;
  // Detail is the canonical source of the granular status (extracting
  // / awaiting_student / in_progress / complete / skipped_unreadable).
  // Overview only carries "in_progress" or "complete" — fine as a
  // fallback while detail is fetching, but detail wins when present.
  const status = integrity?.overall_status ?? overviewFallback?.overall_status ?? null;

  // Disposition wins when the AI reached a verdict. Otherwise route
  // each status to its own copy so a teacher gets actionable info,
  // not a generic "couldn't determine."
  const key = ((): IntegrityBannerKey | null => {
    if (disposition) return disposition;
    if (unfinished) return "unfinished";
    switch (status) {
      case "extracting":
      case "awaiting_student":
      case "in_progress":
      case "skipped_unreadable":
        return status;
      // Complete + no disposition = turn cap hit without conclusion.
      case "complete":
        return "needs_review";
      default:
        return null;
    }
  })();
  if (!key) return null;
  // A teacher who marked the check reviewed has handled it — drop the
  // loud verdict color to a neutral tint (keep the icon/label) so a
  // resolved flag no longer reads as an open alarm.
  const resolved =
    !!integrity && integrity.resolution !== "unresolved";
  const style = resolved
    ? { ...INTEGRITY_STYLE[key], ...NEUTRAL_STYLE }
    : INTEGRITY_STYLE[key];
  // Prefer the agent-emitted headline (chat-grounded verdict title) over
  // the generic per-disposition fallback. AI-emitted is only present
  // when the agent ran a finish_check; non-AI states (extracting,
  // awaiting_student, in_progress, skipped_unreadable) and force-finalize
  // turn-cap rows have a null headline and fall through to style.label.
  // The unfinished state's title is ours, not the stored headline: rows
  // closed before the marker existed still carry "Interview incomplete".
  const title =
    key === "unfinished" ? style.label : (integrity?.headline ?? style.label);
  // Same reason for the summary: the copy below says what happened AND
  // what the grade rests on, which the stored summary never did.
  const answered =
    integrity?.transcript.filter((t) => t.role === "student").length ?? 0;
  const shownSummary =
    key === "unfinished" && unfinished
      ? UNFINISHED_CHECK_COPY[unfinished].body +
        (unfinished === "left_partway" && answered > 0
          ? ` They answered ${answered} ${answered === 1 ? "time" : "times"} before leaving — open the conversation to see how far they got.`
          : "")
      : summary;
  // Hide "Conversation" until at least one student turn exists.
  // For awaiting_student the transcript may carry the AI opener alone;
  // there's nothing meaningful for the teacher to read yet.
  const hasMeaningfulTranscript =
    !!integrity && integrity.transcript.some((t) => t.role === "student");

  const activitySummary = integrity?.activity_summary ?? null;
  const totals = activitySummary?.totals ?? null;
  // "Mark reviewed" is the one primary action on an open flag, so it
  // sits on the collapsed card. Needs full detail (resolution +
  // resolved-by); hidden during the overview-only gap. Once resolved,
  // the resolution chip (with Change) moves into Details.
  const showMarkReviewed =
    !!integrity &&
    integrityNeedsResolution(integrity) &&
    integrity.resolution === "unresolved";
  const inProgressCount = key === "in_progress" && overviewFallback;
  const hasDetails =
    !!shownSummary ||
    key === "unfinished" ||
    !!integrity?.didnt_engage ||
    !!inProgressCount ||
    !!activitySummary ||
    resolved;

  return (
    <>
      <div
        className={`rounded-[--radius-xl] border ${style.border} ${style.bg} p-3.5`}
        role="status"
        aria-live="polite"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${style.iconBg}`}
            aria-hidden
          >
            {style.icon}
          </span>
          <p className="min-w-0 flex-1 pt-0.5 text-sm font-semibold leading-snug text-text-primary">
            {title}
          </p>
        </div>

        {/* Activity flags — only what actually happened. A summary with
            nothing in it gets one quiet line; no summary, nothing. */}
        {totals &&
          (totals.tab_out_count > 0 || totals.paste_count > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {totals.tab_out_count > 0 && (
                <span className="rounded-full border border-border-light bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-text-primary">
                  Tabbed out {totals.tab_out_count}× · {formatMs(totals.tab_out_total_ms)}
                </span>
              )}
              {totals.paste_count > 0 && (
                <span className="rounded-full border border-border-light bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-text-primary">
                  Pasted {totals.paste_total_chars} chars
                </span>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-text-muted">
              No tab-outs or pastes
            </p>
          ))}

        {detailsOpen && hasDetails && (
          <div id={detailsId} className="mt-3 space-y-2.5">
            {(shownSummary ||
              key === "unfinished" ||
              integrity?.didnt_engage ||
              inProgressCount) && (
              <div>
                {shownSummary && (
                  <p className="text-xs leading-relaxed text-text-secondary">
                    {shownSummary}
                  </p>
                )}
                {key === "unfinished" && unfinished && (
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    {UNFINISHED_CHECK_COPY[unfinished].footnote}
                  </p>
                )}
                {/* Neutral note, not a flag: 3+ replies in a row the
                    agent read as not trying. Context for the teacher's
                    own read of the chat; the verdict is unchanged. */}
                {integrity?.didnt_engage && (
                  <p className="mt-1.5 text-xs text-text-muted">
                    Didn&rsquo;t engage with the questions.
                  </p>
                )}
                {inProgressCount && (
                  <p className="mt-1.5 text-xs text-text-muted">
                    {overviewFallback.complete_count} of{" "}
                    {overviewFallback.problem_count} sampled problems graded.
                  </p>
                )}
              </div>
            )}
            {/* Always neutral-styled — the card carries the verdict
                color; the digest is supporting evidence. */}
            <ActivityDigest summary={activitySummary} />
            {integrity && resolved && (
              <ResolveIntegrityControl
                submissionId={integrity.submission_id}
                resolution={integrity.resolution}
                resolvedByName={integrity.resolved_by_name}
                resolvedAt={integrity.resolved_at}
                onResolved={(r) => onResolved(integrity.submission_id, r)}
              />
            )}
          </div>
        )}

        {(hasDetails || hasMeaningfulTranscript || showMarkReviewed) && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {hasDetails ? (
              <button
                type="button"
                onClick={onToggleDetails}
                aria-expanded={detailsOpen}
                aria-controls={detailsOpen ? detailsId : undefined}
                className="rounded-[--radius-sm] text-xs font-semibold text-text-secondary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {detailsOpen ? "Hide details ▴" : "Details ▾"}
              </button>
            ) : (
              <span />
            )}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
              {/* "Mark reviewed" — clearing a flag drops it from the
                  roster Flagged filter. */}
              {showMarkReviewed && (
                <ResolveIntegrityControl
                  primary
                  submissionId={integrity.submission_id}
                  resolution={integrity.resolution}
                  resolvedByName={integrity.resolved_by_name}
                  resolvedAt={integrity.resolved_at}
                  onResolved={(r) => onResolved(integrity.submission_id, r)}
                />
              )}
              {hasMeaningfulTranscript && (
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="shrink-0 rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-primary/40 hover:text-primary focus:border-primary focus:outline-none"
                >
                  Conversation ↗
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {integrity && (
        <ConversationModal
          open={open}
          onClose={() => setOpen(false)}
          integrity={integrity}
        />
      )}
    </>
  );
}

/**
 * Full agent↔student transcript + per-problem verdicts. This is the
 * "drill in" surface for a teacher who doesn't trust the banner's
 * one-line verdict. Turn-by-turn so the teacher can judge for
 * themselves whether the student's explanations actually matched
 * their written work.
 */
function ConversationModal({
  open,
  onClose,
  integrity,
}: {
  open: boolean;
  onClose: () => void;
  integrity: TeacherIntegrityDetail;
}) {
  // Index notable turns by ordinal so each TranscriptTurn can render
  // its inline marker in O(1).
  const notableByOrdinal = useMemo(() => {
    const out = new Map<number, IntegrityActivityNotableTurnLite>();
    for (const nt of integrity.activity_summary?.notable_turns ?? []) {
      out.set(nt.ordinal, nt);
    }
    return out;
  }, [integrity.activity_summary?.notable_turns]);

  // Tool calls, tool results and agent notes (AI text the student never
  // saw) are AI internals — filter before render so the teacher sees the
  // conversation the student had. Turn count in the header reflects the
  // visible count, not the raw transcript length.
  const visibleTurns = useMemo(
    () =>
      integrity.transcript.filter(
        (t) => t.role === "agent" || t.role === "student",
      ),
    [integrity.transcript],
  );

  // Subtitle telegraphs scope before the teacher reads the dialogue:
  // "Discussing Problem 3" / "Discussing Problems 3, 5". Uses HW
  // position so the label matches what the student saw in chat.
  const discussedLabel = useMemo(() => {
    if (integrity.problems.length === 0) return null;
    const positions = integrity.problems
      .map((p) => p.hw_position)
      .sort((a, b) => a - b);
    const noun = positions.length === 1 ? "Problem" : "Problems";
    return `Discussing ${noun} ${positions.join(", ")}`;
  }, [integrity.problems]);

  return (
    // Portaled: the trigger lives in the xl rail AND the below-xl grade
    // column, each display:none on the other side of the breakpoint, so
    // a resize while open must not hide the modal with its subtree.
    <Modal portal open={open} onClose={onClose} className="max-w-3xl bg-surface p-0" label="AI and student conversation">
      <div className="flex items-center justify-between border-b border-border-light px-5 py-3">
        <div>
          <h3 className="text-sm font-bold text-text-primary">
            AI ↔ student conversation
          </h3>
          <p className="text-[11px] text-text-muted">
            {visibleTurns.length} turns
            {discussedLabel && <> · {discussedLabel}</>}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[--radius-md] px-2 py-1 text-xs font-semibold text-text-muted hover:bg-[color:var(--color-surface-alt-2)] hover:text-text-primary"
          aria-label="Close"
        >
          Close ✕
        </button>
      </div>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
        {visibleTurns.map((t) => (
          <TranscriptTurn
            key={t.ordinal}
            turn={t}
            notable={notableByOrdinal.get(t.ordinal)}
          />
        ))}
      </div>
    </Modal>
  );
}

function TranscriptTurn({
  turn,
  notable,
}: {
  turn: TeacherIntegrityTranscriptTurn;
  notable: IntegrityActivityNotableTurnLite | undefined;
}) {
  const isAgent = turn.role === "agent";
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`flex gap-2 ${isAgent ? "" : "flex-row-reverse"}`}>
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
            isAgent
              ? "bg-primary text-white"
              : "bg-[color:var(--color-surface-alt-2)] text-text-secondary"
          }`}
          aria-hidden
        >
          {isAgent ? "AI" : "S"}
        </div>
        <div
          className={`max-w-[80%] rounded-[--radius-md] px-3 py-2 text-xs leading-relaxed ${
            isAgent
              ? "bg-primary-bg text-text-primary"
              : "bg-[color:var(--color-surface-alt-2)] text-text-primary"
          }`}
        >
          <MathText text={turn.content} />
          {turn.seconds_on_turn != null && !isAgent && (
            <span className="mt-1 block text-[11px] text-text-muted">
              · {Math.round(turn.seconds_on_turn)}s to reply
            </span>
          )}
        </div>
      </div>
      {/* Marker hangs under the right-aligned student bubble. ml-auto
        * on a flex-col child pushes it horizontally to the right. */}
      {!isAgent && (
        <div className="ml-auto">
          <ActivityTurnMarker turn={turn} notable={notable} />
        </div>
      )}
    </div>
  );
}
