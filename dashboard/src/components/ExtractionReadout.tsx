import type { ExtractionDetail } from "../lib/api";

/**
 * The strokes beside the transcription — evidence next to interpretation.
 *
 * You cannot diagnose a misread without seeing what was actually on the
 * page, so the photo is pinned on the left while the rows scroll on the
 * right. A count tells you the reader is struggling; only this says how.
 *
 * Shared by the extraction-quality drill-in modal and the submission
 * trace. Those two rendered the same thing for different reasons — one
 * asks "is the reader good", the other "what happened to this student's
 * homework" — and a divergence between them would mean the same
 * submission read differently depending on which door you came through.
 */

/** One row of the read, AI beside student. The diff IS the diagnostic. */
export function ReadRow({ row }: { row: ExtractionDetail["rows"][number] }) {
  const changed = row.changed;
  return (
    <li
      className="xq-row"
      style={{ borderLeftColor: changed ? "var(--warn)" : "var(--rule)" }}
    >
      <div className="xq-row-key">
        {row.unattributed
          ? "unplaced row"
          : row.kind === "final_answer"
            ? `P${row.problem_position} answer`
            : `P${row.problem_position} · step ${row.step_num}`}
        {row.unattributed && (
          // Vision couldn't tie this row to a problem, so the student was
          // never shown it to correct. Often the most interesting misread
          // on the page — dropping it made the list's count disagree with
          // the modal that opened from it.
          <span
            className="xq-unplaced"
            title="The reader could not tell which problem this belongs to, so the student was never asked about it"
          >
            not shown to student
          </span>
        )}
      </div>
      <div className="xq-row-pair">
        <div className="xq-read">
          <span className="xq-read-label">AI read</span>
          <p>{row.ai_read ?? <em>nothing read</em>}</p>
        </div>
        {changed ? (
          <div className="xq-read xq-read-fixed">
            <span className="xq-read-label">Student said</span>
            {row.deleted ? (
              // A cleared row is a DELETION — the overlay drops it. Showing
              // an empty string here would read as "no change" on the one
              // screen built to surface misreads.
              <p><em>row deleted — nothing was written here</em></p>
            ) : (
              <p>{row.student_said}</p>
            )}
          </div>
        ) : (
          <div className="xq-read xq-read-agree">
            <span className="xq-read-label">Student said</span>
            <p className="xq-agree">
              {row.unattributed ? "— never asked —" : "— same —"}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

export default function ExtractionReadout({
  detail,
}: {
  detail: ExtractionDetail;
}) {
  return (
    <div className="xq-detail">
      {/* The strokes. You cannot diagnose a misread without seeing what
          was actually on the page. */}
      <div className="xq-shot">
        {detail.files.length === 0 ? (
          <div className="xq-shot-empty">
            No image stored for this submission.
          </div>
        ) : (
          detail.files.map((f, i) => (
            <img
              key={i}
              src={`data:${f.media_type};base64,${f.data}`}
              alt={`Submitted work, page ${i + 1}`}
              loading="lazy"
            />
          ))
        )}
      </div>
      <div>
        {detail.rows.length === 0 ? (
          <p className="empty-mini">
            {detail.extraction_present
              // The reader ran and came back with nothing. A student can
              // still tap "Looks right" on this, so it must never read
              // like an ordinary blank.
              ? "The reader ran and found no work on these photos."
              : "No read has been stored for this submission yet."}
          </p>
        ) : (
          <ol className="xq-rows">
            {detail.rows.map((r) => <ReadRow key={r.key} row={r} />)}
          </ol>
        )}
      </div>
    </div>
  );
}
