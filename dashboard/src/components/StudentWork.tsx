import ExtractionReadout from "./ExtractionReadout";
import StatusPill from "./StatusPill";
import { STAGE_META } from "../lib/stages";
import { readAnchor } from "../lib/anchor";
import type { ExtractionDetail } from "../lib/api";

// The student's own work, beside what the reader made of it — the
// submission trace's photo section.


export default function StudentWork({
  work,
  targetProblem,
  caseLoaded,
}: {
  work: ExtractionDetail | null;
  targetProblem: number | null;
  /** The case table above owns `#p{n}`; the readout's rows take `#read-p{n}`. */
  caseLoaded: boolean;
}) {
  if (!work) return null;
  const corrected = work.rows.filter((r) => r.changed).length;
  const meta = STAGE_META[work.stage];
  // A `#p{n}` link with nothing read for that problem still has to say
  // so — otherwise the page just sits at the section and looks broken.
  const targetMissing =
    targetProblem !== null && !work.rows.some((r) => r.problem_position === targetProblem);
  return (
    <section className="cf-work" id="student-work">
      <h3 className="cf-work-head">
        Student work
        <span className="cf-work-sub">
          {work.files_count === 1 ? "1 page" : `${work.files_count} pages`}
          {work.rows.length > 0 && (
            <>
              {" · "}
              {corrected === 0
                ? `${work.rows.length} rows read, none corrected`
                : `${corrected} of ${work.rows.length} rows corrected by the student`}
            </>
          )}
          {targetMissing && (
            <span className="cf-work-target-missing">
              {' · '}nothing was read for Problem {targetProblem}
            </span>
          )}
        </span>
        <span className="cf-work-stage">
          <StatusPill tone={meta.tone} label={meta.label} title={meta.blurb} />
        </span>
      </h3>
      <ExtractionReadout detail={work} targetProblem={targetProblem} anchorId={caseLoaded ? readAnchor : undefined} />
    </section>
  );
}
