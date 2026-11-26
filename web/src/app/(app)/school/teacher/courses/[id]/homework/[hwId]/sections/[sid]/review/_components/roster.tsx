import { useEffect } from "react";
import {
  ActivityPill,
  RowDispositionPill,
} from "@/components/school/teacher/_pieces/integrity-pieces";
import type { RosterEntry, RosterFilter } from "../_lib/types";
import {
  isFlagged,
  needsTeacher,
  isAwaitingGrade,
  isAiGrading,
  hasGraphToCheck,
  hasLowConfidence,
  classOnly,
  rowStatusLabel,
  reviewMarker,
  lateLabel,
  formatPercent,
} from "../_lib/grading";

export function RosterFilterBar({
  roster,
  value,
  onChange,
}: {
  roster: RosterEntry[];
  value: RosterFilter;
  onChange: (v: RosterFilter) => void;
}) {
  // Chips are class triage, so they count her students — and the list
  // they filter to must be the same population, or a chip reading 1
  // opens a list of 2.
  const forCounting = classOnly(roster);
  const flaggedCount = forCounting.filter(isFlagged).length;
  const needsMeCount = forCounting.filter(needsTeacher).length;
  const lowConfidenceCount = forCounting.filter(hasLowConfidence).length;

  // Auto-revert to "all" when the active filter's count drops to 0 —
  // otherwise a teacher who clears the last flagged submission gets
  // stranded on a disabled-yet-active chip with an empty roster and
  // no obvious recovery. Live grading frequently transitions a row
  // out of `needs_me` (publish a grade), so this guard fires often.
  // Low-confidence count is fixed by the AI's read and never moves on a
  // teacher action, but we guard it the same way for consistency.
  useEffect(() => {
    if (value === "needs_me" && needsMeCount === 0) onChange("all");
    if (value === "flagged" && flaggedCount === 0) onChange("all");
    if (value === "low_confidence" && lowConfidenceCount === 0) onChange("all");
  }, [value, needsMeCount, flaggedCount, lowConfidenceCount, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border-light px-3 py-2">
      <RosterChip label="All" active={value === "all"} onClick={() => onChange("all")} />
      <RosterChip
        label="Needs me"
        count={needsMeCount}
        active={value === "needs_me"}
        disabled={needsMeCount === 0}
        onClick={() => onChange("needs_me")}
      />
      <RosterChip
        label="Flagged"
        count={flaggedCount}
        active={value === "flagged"}
        disabled={flaggedCount === 0}
        onClick={() => onChange("flagged")}
      />
      <RosterChip
        label="Low confidence"
        count={lowConfidenceCount}
        active={value === "low_confidence"}
        disabled={lowConfidenceCount === 0}
        onClick={() => onChange("low_confidence")}
        title="Problems the AI graded with low confidence (under 60%) — review the uncertain calls first"
      />
    </div>
  );
}

function RosterChip({
  label,
  count,
  active,
  disabled,
  onClick,
  title,
}: {
  label: string;
  count?: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-[--radius-pill] border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
        active
          ? "border-primary bg-primary-bg text-primary"
          : disabled
            ? "border-border-light bg-[color:var(--color-surface-alt-2)] text-text-muted/60 cursor-not-allowed"
            : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-text-primary"
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          className={`rounded-[--radius-pill] px-1 text-[10px] tabular-nums ${
            active ? "bg-primary text-white" : "bg-[color:var(--color-surface-alt-2)] text-text-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Triage roster — groups the (already-filtered) roster into "Needs your
// eyes" (integrity-flagged OR low-confidence) above "AI confident", with
// non-submitters last. Within "Needs your eyes" the order is uncertainty-
// first: flagged before low-confidence, then lowest score first, so the
// calls most worth the teacher's attention float to the very top.
// ────────────────────────────────────────────────────────────────────

export function TriageRoster({
  roster,
  filter,
  selectedStudentId,
  onSelect,
  aiPendingIds,
  aiPollGaveUp,
}: {
  roster: RosterEntry[];
  filter: RosterFilter;
  selectedStudentId: string | null;
  onSelect: (id: string) => void;
  aiPendingIds: ReadonlySet<string>;
  aiPollGaveUp: boolean;
}) {
  const needsEyes: RosterEntry[] = [];
  const awaitingGrade: RosterEntry[] = [];
  const confident: RosterEntry[] = [];
  const notSubmitted: RosterEntry[] = [];
  // Her rehearsal is a row, not a member of any triage group. The group
  // headers count her class — a "Needs your eyes · 1" over her own test
  // run contradicts the subhead and the chips, which both read
  // classOnly. Rendered after the groups instead, where the badge is
  // the whole story.
  let rehearsal: RosterEntry | null = null;
  for (const e of roster) {
    if (e.submission?.is_preview) {
      rehearsal = e;
      continue;
    }
    if (!e.submission) notSubmitted.push(e);
    else if (isFlagged(e) || hasLowConfidence(e) || hasGraphToCheck(e)) needsEyes.push(e);
    // Ungraded gets its own group. It used to fall into "AI confident"
    // — technically true (nothing was flagged) and substantively a lie,
    // because the AI hadn't looked at the work at all. That was almost
    // invisible while grading ran seconds after a student confirmed;
    // now that grading waits for the due date it would be the normal
    // state of a class all week. Never file work the AI hasn't seen
    // under a claim about the AI's confidence.
    else if (isAwaitingGrade(e)) awaitingGrade.push(e);
    else confident.push(e);
  }
  // Uncertainty-first: flagged (0) before low-confidence (1), then by
  // ascending score (a null score — ungraded — sorts to the very top).
  const prio = (e: RosterEntry) => (isFlagged(e) ? 0 : 1);
  needsEyes.sort((a, b) => {
    const p = prio(a) - prio(b);
    if (p !== 0) return p;
    const sa = a.submission?.final_score ?? -1;
    const sb = b.submission?.final_score ?? -1;
    return sa - sb;
  });

  if (roster.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-text-muted">
        {filter === "needs_me"
          ? "Nothing waiting on you here."
          : filter === "flagged"
            ? "No flagged submissions in this section."
            : filter === "low_confidence"
              ? "The AI was confident on every graded problem here."
              : "No students match this filter."}
      </p>
    );
  }

  const renderRows = (entries: RosterEntry[]) =>
    entries.map((e) => (
      <StudentRow
        key={e.student_id}
        entry={e}
        selected={e.student_id === selectedStudentId}
        onSelect={() => onSelect(e.student_id)}
        aiGrading={
          !!e.submission && isAiGrading(e.submission, aiPendingIds)
            ? aiPollGaveUp && !aiPendingIds.has(e.submission.id)
              ? "unwatched"
              : "watched"
            : false
        }
      />
    ));

  return (
    <>
      {needsEyes.length > 0 && (
        <RosterGroupHeader
          label="Needs your eyes"
          count={needsEyes.length}
          tone="eyes"
        />
      )}
      {renderRows(needsEyes)}
      {awaitingGrade.length > 0 && (
        // Above "AI confident": work with no verdict yet is more
        // actionable than work the AI has already cleared.
        <RosterGroupHeader
          label="Awaiting grade"
          count={awaitingGrade.length}
          tone="calm"
        />
      )}
      {renderRows(awaitingGrade)}
      {confident.length > 0 && (
        <RosterGroupHeader
          label="AI confident"
          count={confident.length}
          tone="calm"
        />
      )}
      {renderRows(confident)}
      {notSubmitted.length > 0 && (
        <RosterGroupHeader
          label="Not submitted"
          count={notSubmitted.length}
          tone="calm"
        />
      )}
      {renderRows(notSubmitted)}
      {rehearsal && (
        <>
          <RosterGroupHeader label="Your test run" count={1} tone="calm" />
          {renderRows([rehearsal])}
        </>
      )}
    </>
  );
}

function RosterGroupHeader({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "eyes" | "calm";
}) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border-light bg-[color:var(--color-surface-alt-2)]/40 px-4 pb-1.5 pt-2.5">
      {tone === "eyes" && (
        <span aria-hidden className="text-[color:var(--color-warning-dark)]">
          ⚠
        </span>
      )}
      <span
        className={`text-[11px] font-bold uppercase tracking-[0.14em] ${
          tone === "eyes"
            ? "text-[color:var(--color-warning-dark)]"
            : "text-text-muted"
        }`}
      >
        {label}
      </span>
      <span className="ml-auto text-[11px] font-bold text-text-muted tabular-nums">
        {count}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Student list row — the clickable link to a specific submission.
// ────────────────────────────────────────────────────────────────────

function StudentRow({
  entry,
  selected,
  onSelect,
  aiGrading,
}: {
  entry: RosterEntry;
  selected: boolean;
  onSelect: () => void;
  /** "unwatched" = still running on the server after the page's poll
   *  gave up, so the row can't promise to update itself. */
  aiGrading: false | "watched" | "unwatched";
}) {
  const sub = entry.submission;
  const statusLabel = rowStatusLabel(entry, aiGrading);
  const review = sub ? reviewMarker(sub) : null;
  const mutedName = sub === null;
  const overview = sub?.integrity_overview ?? null;
  const showsDispositionPill =
    !!sub?.unfinished_check ||
    (overview?.overall_status === "complete" &&
      (overview.disposition === "flag_for_review" ||
        overview.disposition === "tutor_pivot" ||
        !overview.disposition));
  const showsActivityPill = (overview?.notable_count ?? 0) > 0;
  const hasScore = sub?.final_score != null;
  const hasAnyPill = showsDispositionPill || showsActivityPill;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full flex-col gap-1.5 border-b border-border-light px-4 py-2.5 text-left text-sm transition-colors last:border-b-0 ${
        selected ? "bg-primary-bg/40" : "hover:bg-[color:var(--color-surface-alt-2)]"
      }`}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        {/* Score sits next to the name on the header row — it answers
         * "how did they do?", which is the natural pairing with
         * student identity. Pulling it out of the pill row keeps that
         * row exclusively for filled pills, so we don't have a plain
         * number sandwiched between two colored pills. */}
        <div
          className={`min-w-0 flex-1 truncate font-semibold ${
            mutedName ? "text-text-muted" : "text-text-primary"
          }`}
        >
          {entry.student_name}
          {/* Her own rehearsal sits at the end of the roster. Badged so
              a row that isn't a student can't be mistaken for one. */}
          {sub?.is_preview && (
            <span className="ml-1.5 rounded-full bg-[color:var(--color-info-light)] px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-info)]">
              Preview
            </span>
          )}
        </div>
        {hasScore && (
          <span
            className={`shrink-0 text-xs font-bold ${
              sub!.grade_published_at && !sub!.grade_dirty
                ? "text-[color:var(--color-success)] "
                : "text-text-secondary"
            }`}
          >
            {Math.round(sub!.final_score!)}%
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusLabel.dotClass}`}
        />
        <span className="truncate">{statusLabel.text}</span>
        {entry.personal_due_at && (
          <span className="ml-1 shrink-0 font-semibold text-primary">· reopened</span>
        )}
        {sub?.is_late && (
          <span className="ml-1 shrink-0 font-semibold text-[color:var(--color-error)]">
            · {lateLabel(sub.days_late)}
            {sub.late_penalty > 0 && ` −${formatPercent(sub.late_penalty_percent)}%`}
            {sub.late_penalty_waived && sub.late_penalty_percent > 0 && (
              <span className="font-normal text-text-muted"> (waived)</span>
            )}
          </span>
        )}
      </div>
      {/* Approval marker — separates a grade the teacher has explicitly
       * approved from one that's graded but not yet approved. Its own
       * line so it reads as a distinct dimension from the publish-state
       * status above. */}
      {review && (
        <div
          className={`flex min-w-0 items-center gap-1 text-[11px] font-semibold ${
            review.tone === "reviewed"
              ? "text-[color:var(--color-success)]"
              : "text-text-muted"
          }`}
        >
          <span aria-hidden>{review.tone === "reviewed" ? "✓" : "○"}</span>
          <span className="truncate">{review.text}</span>
        </div>
      )}
      {/* Disposition + activity pills on their own row, right-aligned.
       * The 280px-wide side panel can fit them together in the common
       * case ("Review" + "Activity: N notable moments"); rare wide
       * combinations (e.g. "Inconclusive" + long activity copy) wrap,
       * but each wrapped line is then a single semantically-coherent
       * pill, which reads cleaner than mixing pills with bare text.
       *
       * Order: disposition first (most urgent — "should I look at this
       * row?"), then activity (supporting behavior context). Quiet
       * rows (pass / needs_practice / clean activity) render no pill
       * row at all so loud rows actually pop. */}
      {hasAnyPill && (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <RowDispositionPill
            overview={overview}
            unfinished={sub?.unfinished_check ?? null}
          />
          <ActivityPill count={overview?.notable_count ?? null} />
        </div>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Empty state for a student who hasn't turned in work. No grading
// path from here — we can't grade missing work.
// ────────────────────────────────────────────────────────────────────

export function NotSubmittedCard({ entry, reopen }: { entry: RosterEntry; reopen: React.ReactNode }) {
  return (
    <div className="rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-bold text-text-primary">{entry.student_name}</h2>
      <p className="text-xs text-text-muted">{entry.student_email}</p>
      {/* Reopening is the one thing to do for missing work: give them
          their own due date (a closed homework takes it again). */}
      {reopen}
      <div className="mt-5 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)]/60 px-6 py-10 text-center">
        <p className="text-sm font-bold text-text-primary">Not submitted</p>
        <p className="mt-1 text-xs text-text-muted">
          This student hasn&apos;t turned in this homework yet.
        </p>
      </div>
    </div>
  );
}
