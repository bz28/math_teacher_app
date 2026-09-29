import type { ExtractionDetail } from "../lib/api";
import { problemAnchor } from "../lib/anchor";
import MathText from "./MathText";
import PdfPages from "./PdfPages";

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

/**
 * The prose inside a read that is ONE `\text{…}` group and nothing else,
 * or null. Vision writes a written-out answer that way, and KaTeX sets a
 * text group as a single unbreakable line — a sentence ran off the side
 * of its column. Only a whole-read group qualifies: `\text{a} + \text{b}`
 * matches the outer braces too, but its body is unbalanced, so it stays
 * maths.
 */
function wholeTextGroup(latex: string): string | null {
  const body = /^\\text\{([\s\S]*)\}$/.exec(latex.trim())?.[1];
  if (body === undefined) return null;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") i++;
    else if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth < 0) return null;
  }
  if (depth !== 0) return null;
  // Text-mode escapes. `\$` stays escaped: MathText reads a bare `$` as a
  // maths delimiter, which is how inline maths inside the prose renders.
  return body.replace(/\\([{}%&#_])/g, "$1");
}

/**
 * One side of a row, typeset the way the student saw it on the confirm
 * screen: a LaTeX read as display maths, a plain read as text. Printing
 * the LaTeX source made every row read as code, and made "did the
 * student really agree with THIS?" harder to judge than it was for the
 * student.
 */
function ReadText({ text, isLatex }: { text: string; isLatex: boolean }) {
  if (!isLatex) return <p>{text}</p>;
  const prose = wholeTextGroup(text);
  return (
    <div className="xq-math">
      {prose !== null ? (
        <div className="xq-prose"><MathText>{prose}</MathText></div>
      ) : (
        <MathText>{`$$${text}$$`}</MathText>
      )}
    </div>
  );
}

/** One uploaded file of the student's work. A submission is photos OR
 *  scanned PDFs — an <img> cannot show a PDF, so it renders page by page
 *  instead. `index` is 0-based. */
export function WorkFile({
  file,
  index,
}: {
  file: ExtractionDetail["files"][number];
  index: number;
}) {
  return file.media_type === "application/pdf" ? (
    <PdfPages b64={file.data} label={`Submitted work, file ${index + 1}`} />
  ) : (
    <img
      src={`data:${file.media_type};base64,${file.data}`}
      alt={`Submitted work, page ${index + 1}`}
      loading="lazy"
    />
  );
}

/** One row of the read, AI beside student. The diff IS the diagnostic. */
export function ReadRow({
  row,
  id,
  target = false,
}: {
  row: ExtractionDetail["rows"][number];
  /** The problem's `#p{n}` anchor — set on its first row only. */
  id?: string;
  /** This row belongs to the problem a deep link pointed at. */
  target?: boolean;
}) {
  const changed = row.changed;
  return (
    <li
      id={id}
      className={`xq-row${target ? " xq-row-target" : ""}`}
      style={target ? undefined : { borderLeftColor: changed ? "var(--warn)" : "var(--rule)" }}
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
          {row.ai_read === null ? (
            <p><em>nothing read</em></p>
          ) : (
            <ReadText text={row.ai_read} isLatex={row.is_latex} />
          )}
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
              // A correction edits the same source as the read, so it
              // shares the read's format.
              <ReadText text={row.student_said ?? ""} isLatex={row.is_latex} />
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
  targetProblem = null,
}: {
  detail: ExtractionDetail;
  /** Problem a `#p{n}` link pointed at: its rows are marked, and its
   *  first row carries the anchor. */
  targetProblem?: number | null;
}) {
  // Steps come before final answers, so a problem's first row is its
  // first step — the natural place to land.
  const anchored = new Set<number>();
  const anchorFor = (pos: number | null) => {
    if (pos === null || anchored.has(pos)) return undefined;
    anchored.add(pos);
    return problemAnchor(pos);
  };
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
          // A submission is photos OR scanned PDFs — an <img> cannot show
          // a PDF, so it renders page by page instead.
          detail.files.map((f, i) => <WorkFile key={i} file={f} index={i} />)
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
              // "Yet" promises a read that is still coming — true only
              // when one was owed. With both toggles off none was, and
              // none is: saying "yet" there reports the teacher's
              // setting as a pending obligation, the same conflation
              // the stage vocabulary exists to prevent.
              : detail.integrity_check_enabled || detail.ai_grading_enabled
                ? "No read has been stored for this submission yet."
                : "No read was requested — AI is switched off for this homework."}
          </p>
        ) : (
          <ol className="xq-rows">
            {detail.rows.map((r) => (
              <ReadRow
                key={r.key}
                row={r}
                id={r.unattributed ? undefined : anchorFor(r.problem_position)}
                target={targetProblem !== null && r.problem_position === targetProblem}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
