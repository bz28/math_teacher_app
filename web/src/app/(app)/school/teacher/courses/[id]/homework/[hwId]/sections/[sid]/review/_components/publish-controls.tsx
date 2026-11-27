import { Modal } from "@/components/ui/modal";

// ────────────────────────────────────────────────────────────────────
// Publish, on the section review page. Publishing releases approved
// grades only — never one she hasn't approved — and acts on this
// section, the class she's reviewing. "Publish all periods" in the
// confirm reaches every section of the homework under the same rule.
// ────────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Page-header Publish. States, in order:
 *   • approved grades to release here → "Publish N approved →"
 *     ("Republish N →" when every one is an edit to a published grade)
 *   • only unapproved ones here       → "N waiting for your approval"
 *   • other periods have approved     → quiet "Publish other periods (K)",
 *                                       beside that pill when both apply
 *   • everything here released        → "All grades published"
 *   • nothing graded here             → "No grades to publish" */
export function PublishButton({
  approved,
  approvedEdits,
  unapproved,
  graded,
  approvedOtherSections,
  onOpen,
}: {
  approved: number;
  /** Of `approved`, edits to already-published grades. */
  approvedEdits: number;
  unapproved: number;
  graded: number;
  approvedOtherSections: number;
  onOpen: () => void;
}) {
  if (approved > 0) {
    const verb = approvedEdits === approved ? "Republish" : "Publish";
    return (
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-dark"
      >
        {verb} {approved} approved →
      </button>
    );
  }
  const otherPeriods = approvedOtherSections > 0 && (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-[--radius-md] border border-primary/30 bg-primary-bg px-3.5 py-1.5 text-xs font-bold text-primary transition-colors hover:border-primary/60"
    >
      Publish other periods ({approvedOtherSections}) →
    </button>
  );
  if (unapproved > 0) {
    // Nothing here to publish yet, but another period's approved
    // grades are still reachable from this page.
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-[--radius-pill] bg-[color:var(--color-surface-alt-2)] px-3 py-1.5 text-xs font-semibold text-text-muted"
          title="Only grades you approve are published. Approve a student to publish their grade."
        >
          {unapproved} waiting for your approval
        </span>
        {otherPeriods}
      </span>
    );
  }
  if (otherPeriods) return otherPeriods;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[--radius-pill] bg-[color:var(--color-surface-alt-2)] px-3 py-1.5 text-xs font-semibold text-text-muted">
      {graded > 0 && (
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
      )}
      {graded > 0 ? "All grades published" : "No grades to publish"}
    </span>
  );
}

export function PublishConfirmDialog({
  open,
  onClose,
  sectionName,
  approved,
  approvedEdits,
  unapproved,
  flagged,
  graph,
  approvedAll,
  unapprovedAll,
  flaggedOther,
  graphOther,
  publishing,
  error,
  onPublish,
}: {
  open: boolean;
  onClose: () => void;
  sectionName: string;
  /** This section: approved grades to release, and how many of those
   *  are edits to published grades. */
  approved: number;
  approvedEdits: number;
  /** This section: graded but not approved — they stay hidden. */
  unapproved: number;
  /** Of `approved`: integrity flagged and unresolved / graph items
   *  still to check. Warnings, never blocks. */
  flagged: number;
  graph: number;
  /** Every section of the homework. */
  approvedAll: number;
  unapprovedAll: number;
  /** Other periods: approved grades going out flagged / with graph
   *  items open. Said on the Publish all line, never a block. */
  flaggedOther: number;
  graphOther: number;
  publishing: boolean;
  error: string | null;
  onPublish: (scope: "section" | "all") => void;
}) {
  const where = sectionName || "this period";
  const otherApproved = approvedAll - approved;
  return (
    <Modal open={open} onClose={onClose} dismissible={!publishing} label="Confirm grade publishing">
      <h2 className="text-lg font-bold text-text-primary">
        {approved > 0
          ? `Publish ${approved} approved ${plural(approved, "grade", "grades")} for ${where}?`
          : `Nothing approved to publish in ${where} yet`}
      </h2>
      {approved > 0 && (
        <p className="mt-2 text-sm text-text-secondary">
          {where} students see their {approvedEdits === approved ? "updated " : ""}
          score and feedback right away.
          {approvedEdits > 0 && approvedEdits < approved && (
            <> {approvedEdits} {plural(approvedEdits, "is an edit", "are edits")} to a published grade.</>
          )}
        </p>
      )}
      {unapproved > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-xs text-text-secondary">
          <span className="font-semibold text-text-primary">{unapproved}</span>{" "}
          {plural(unapproved, "grade isn’t", "grades aren’t")} approved yet and{" "}
          {plural(unapproved, "stays", "stay")} hidden until you approve{" "}
          {plural(unapproved, "it", "them")}.
        </p>
      )}
      {flagged > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-[color:var(--color-error)]/30 bg-[color:var(--color-error-light)] px-3 py-2 text-xs text-[color:var(--color-error)]">
          <span aria-hidden>⚑ </span>
          <span className="font-semibold">{flagged}</span>{" "}
          {plural(flagged, "approved grade has", "approved grades have")} an understanding
          check flagged for review and not yet resolved. Publish anyway, or close this and
          look first?
        </p>
      )}
      {graph > 0 && (
        <p className="mt-3 rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt-2)] px-3 py-2 text-xs text-text-secondary">
          <span className="font-semibold text-text-primary">{graph}</span>{" "}
          {plural(graph, "grade still has", "grades still have")} graph items to check.
          Those items count as correct until you mark them; a ✗ lowers the score the next
          time you publish.
        </p>
      )}
      {otherApproved > 0 && (
        <p className="mt-3 text-xs text-text-muted">
          Publish all periods releases {approvedAll} approved{" "}
          {plural(approvedAll, "grade", "grades")} across every period of this homework
          {unapprovedAll > 0 && (
            <>; {unapprovedAll} not yet approved stay hidden</>
          )}
          .
          {(flaggedOther > 0 || graphOther > 0) && (
            <>
              {" "}In other periods,{" "}
              {[
                flaggedOther > 0 &&
                  `${flaggedOther} ${plural(flaggedOther, "has", "have")} a flagged understanding check`,
                graphOther > 0 &&
                  `${graphOther} still ${plural(graphOther, "has", "have")} graph items to check`,
              ]
                .filter(Boolean)
                .join(" and ")}
              .
            </>
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-[color:var(--color-error)]">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={publishing}
          className="rounded-[--radius-md] border border-border-light bg-surface px-4 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-primary/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        {otherApproved > 0 && (
          <button
            type="button"
            onClick={() => onPublish("all")}
            disabled={publishing}
            className="rounded-[--radius-md] border border-primary/40 bg-primary-bg px-4 py-2 text-xs font-bold text-primary transition-colors hover:border-primary/70 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Publish all periods ({approvedAll})
          </button>
        )}
        {approved > 0 && (
          <button
            type="button"
            onClick={() => onPublish("section")}
            disabled={publishing}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {publishing ? "Publishing…" : `Publish ${approved} for ${where}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
