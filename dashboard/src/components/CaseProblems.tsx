import { Fragment, useEffect, useState } from "react";
import MathText from "./MathText";
import StatusPill, { type PillTone } from "./StatusPill";
import { problemAnchor } from "../lib/anchor";
import type {
  CaseIntegrity,
  CaseIntegrityProblem,
  CaseProblem,
  CaseReadingLine,
  SubmissionCase,
} from "../lib/caseFile";

// The case file's per-problem table: for each problem, what the reader
// got, what the AI gave it (and how sure it was), where the grade ended
// up, and what the understanding check made of it. A row the teacher
// moved off the AI's call is tinted — that's the row to read first.
// Clicking a row opens everything behind it and puts `#p{n}` in the URL,
// so the link a report sends lands on the same open row.

const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}%`);

/** One read line, as the teacher view renders it: math as math. */
function ReadLine({ line }: { line: CaseReadingLine }) {
  if (line.latex) return <MathText>{`$${line.latex}$`}</MathText>;
  return <>{line.plain}</>;
}

/** The collapsed one-line readout for the table cell: steps → answer. */
function readSummary(p: CaseProblem): string {
  const r = p.reading;
  if (!r) return "";
  const lines = [...r.steps, ...(r.final_answer ? [r.final_answer] : [])];
  return lines.map((l) => l.latex || l.plain).join("  →  ");
}

type CheckMeta = { tone: PillTone; label: string };

// A verdict's rubric, read the way the teacher's understanding panel
// reads it: any "low" is a weak explanation, all "high" a solid one.
function rubricWord(rubric: Record<string, string> | null): CheckMeta {
  const vals = Object.entries(rubric ?? {})
    .filter(([k]) => k !== "self_correction")
    .map(([, v]) => v);
  if (vals.some((v) => v === "low")) return { tone: "danger", label: "probed · weak" };
  if (vals.length > 0 && vals.every((v) => v === "high")) return { tone: "ok", label: "probed · solid" };
  return { tone: "warn", label: vals.length ? "probed · mixed" : "probed" };
}

function checkMeta(ip: CaseIntegrityProblem | null, check: CaseIntegrity | null): CheckMeta {
  if (!ip) {
    return check
      ? { tone: "neutral", label: "not needed" }
      : { tone: "neutral", label: "no check" };
  }
  switch (ip.kind) {
    case "probed": return rubricWord(ip.rubric);
    case "probed_pending": return { tone: "info", label: "in chat" };
    case "inconclusive": return { tone: "warn", label: "inconclusive" };
    case "unfinished": return { tone: "warn", label: "unfinished" };
    case "diagnosed": return { tone: "info", label: "diagnosed" };
    case "blank": return { tone: "neutral", label: "blank" };
    case "unreadable": return { tone: "warn", label: "unreadable" };
    case "diagnosis_failed": return { tone: "danger", label: "diagnosis failed" };
    default: return { tone: "neutral", label: ip.kind.replace(/_/g, " ") };
  }
}

const words = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ");

export default function CaseProblems({
  data, targetProblem,
}: {
  data: SubmissionCase;
  /** The problem a `#p{n}` link points at: opened and marked. */
  targetProblem: number | null;
}) {
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(targetProblem !== null ? [targetProblem] : []),
  );
  // A hash change on the same page (another report link) opens that row.
  useEffect(() => {
    if (targetProblem === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen((s) => (s.has(targetProblem) ? s : new Set(s).add(targetProblem)));
  }, [targetProblem]);

  const overrode = data.problems.filter((p) => p.final?.differs_from_ai).length;
  const graded = data.problems.filter((p) => p.final).length;

  const toggle = (position: number) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(position)) {
        next.delete(position);
      } else {
        next.add(position);
        // Linkable: the row's own anchor, without a scroll jump.
        window.history.replaceState(null, "", `#${problemAnchor(position)}`);
      }
      return next;
    });
  };

  return (
    <section className="cp" id="case-problems" aria-labelledby="cp-head">
      <div className="cp-head">
        <h3 id="cp-head" className="cp-title">Per problem</h3>
        {overrode > 0 && (
          <span className="cp-overrode">Teacher overrode {overrode} of {graded}</span>
        )}
        <span className="cp-hint">Click a row to open what the reader got, the AI's reasoning and the check</span>
      </div>
      {data.problems.length === 0 ? (
        <p className="cp-empty">This homework has no problems on record.</p>
      ) : (
        <table className="cp-table">
          <thead>
            <tr>
              <th className="cp-num">#</th>
              <th>What the reader got</th>
              <th className="cp-r">AI</th>
              <th className="cp-r">Conf.</th>
              <th className="cp-r">Final</th>
              <th>Understanding check</th>
              <th>AI reasoning</th>
            </tr>
          </thead>
          <tbody>
            {data.problems.map((p) => {
              const isOpen = open.has(p.position);
              const differs = Boolean(p.final?.differs_from_ai);
              const check = checkMeta(p.integrity, data.integrity);
              const summary = readSummary(p);
              return (
                <Fragment key={p.bank_item_id}>
                  <tr
                    id={problemAnchor(p.position)}
                    className={`cp-row${differs ? " cp-row-differs" : ""}${
                      p.position === targetProblem ? " cp-row-target" : ""
                    }${isOpen ? " cp-row-open" : ""}`}
                    onClick={() => toggle(p.position)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle(p.position);
                      }
                    }}
                    tabIndex={0}
                    aria-expanded={isOpen}
                  >
                    <td className="cp-num">P{p.position}</td>
                    <td className="cp-read" title={summary}>
                      {p.reading === null ? (
                        <span className="cp-muted">reader never ran</span>
                      ) : summary ? (
                        summary
                      ) : (
                        <span className="cp-muted">nothing read</span>
                      )}
                      {p.reading?.student_edited && <span className="cp-edited">edited</span>}
                    </td>
                    <td className="cp-r cp-mono">{pct(p.ai_call)}</td>
                    <td className="cp-r cp-mono">
                      {p.grade?.confidence != null ? p.grade.confidence.toFixed(2) : "—"}
                    </td>
                    <td className={`cp-r cp-mono${differs ? " cp-final-differs" : ""}`}>
                      {pct(p.final?.percent)}
                    </td>
                    <td>
                      <StatusPill tone={check.tone} label={check.label} />
                      {p.integrity?.teacher_dismissed && <span className="cp-edited">dismissed</span>}
                    </td>
                    <td className="cp-reason" title={p.grade?.reasoning ?? undefined}>
                      {p.grade?.reasoning ?? (
                        <span className="cp-muted">
                          {p.ai_call != null ? "No grade returned — stamped zero" : "Not AI-graded"}
                        </span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="cp-detail-row">
                      <td colSpan={7}>
                        <ProblemDetail p={p} check={data.integrity} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {data.unplaced_reading.length > 0 && (
        <p className="cp-unplaced">
          <span className="cp-label">Read but not placed on a problem</span>
          {data.unplaced_reading.map((l, i) => (
            <span key={i} className="cp-unplaced-line"><ReadLine line={l} /></span>
          ))}
        </p>
      )}
    </section>
  );
}

function ProblemDetail({ p, check }: { p: CaseProblem; check: CaseIntegrity | null }) {
  const ip = p.integrity;
  const probed = ip && (ip.kind === "probed" || ip.kind === "probed_pending" || ip.kind === "inconclusive" || ip.kind === "unfinished");
  return (
    <div className="cp-detail">
      <div className="cp-detail-col">
        <div className="cp-label">Question</div>
        <div className="cp-q"><MathText>{p.question}</MathText></div>
        {p.answer_key && (
          <div className="cp-key">Key: <MathText>{p.answer_key}</MathText></div>
        )}
        <div className="cp-label">
          What the reader got{p.reading?.student_edited ? " · corrected by the student" : ""}
        </div>
        {p.reading && (p.reading.steps.length > 0 || p.reading.final_answer) ? (
          <ol className="cp-steps">
            {p.reading.steps.map((l, i) => (
              <li key={i}><ReadLine line={l} /></li>
            ))}
            {p.reading.final_answer && (
              <li className="cp-steps-final"><span className="cp-muted">answer</span> <ReadLine line={p.reading.final_answer} /></li>
            )}
          </ol>
        ) : (
          <p className="cp-muted">{p.reading ? "Nothing was read for this problem." : "The reader never ran."}</p>
        )}
        <a className="cp-link" href={`#read-${problemAnchor(p.position)}`}>See it on the photo ↓</a>
      </div>
      <div className="cp-detail-col">
        <div className="cp-label">The AI's grade</div>
        {p.grade ? (
          <>
            <p className="cp-line">
              <strong>{pct(p.grade.percent)}</strong> · {p.grade.score_status}
              {p.grade.confidence != null && <> · confidence {p.grade.confidence.toFixed(2)}</>}
            </p>
            {p.grade.student_answer && (
              <p className="cp-line">Read the answer as <MathText>{p.grade.student_answer}</MathText></p>
            )}
            {p.grade.reasoning && <p className="cp-prose">{p.grade.reasoning}</p>}
            {p.grade.student_feedback && (
              <p className="cp-prose cp-muted">To the student: {p.grade.student_feedback}</p>
            )}
          </>
        ) : (
          <p className="cp-muted">
            {p.ai_call != null
              ? "The grader returned no grade for this problem; it was stamped zero."
              : "Not graded by the AI."}
          </p>
        )}
        <div className="cp-label">Final</div>
        {p.final ? (
          <p className="cp-line">
            <strong>{pct(p.final.percent)}</strong> · {p.final.score_status}
            {p.final.differs_from_ai && <span className="cp-overrode cp-inline">teacher overrode</span>}
            {p.final.feedback && <span className="cp-prose cp-block">{p.final.feedback}</span>}
          </p>
        ) : (
          <p className="cp-muted">No grade yet.</p>
        )}
      </div>
      <div className="cp-detail-col">
        <div className="cp-label">Understanding check</div>
        {!ip ? (
          <p className="cp-muted">
            {check ? "The check didn't sample this problem." : "No understanding check on this submission."}
          </p>
        ) : (
          <>
            <p className="cp-line">
              {words(ip.kind)}
              {ip.selected_reason && <span className="cp-muted"> · picked as {words(ip.selected_reason)}</span>}
            </p>
            {ip.rubric && (
              <dl className="cp-rubric">
                {Object.entries(ip.rubric).map(([k, v]) => (
                  <Fragment key={k}><dt>{words(k)}</dt><dd>{words(v)}</dd></Fragment>
                ))}
              </dl>
            )}
            {ip.reasoning && <p className="cp-prose">{ip.reasoning}</p>}
            {ip.diagnosis_note && (
              <p className="cp-prose">
                {ip.diagnosis_kind && <strong>{words(ip.diagnosis_kind)}: </strong>}
                {ip.diagnosis_note}
              </p>
            )}
            {ip.teacher_dismissed && (
              <p className="cp-prose cp-muted">
                Teacher dismissed this{ip.teacher_dismissal_reason ? `: ${ip.teacher_dismissal_reason}` : "."}
              </p>
            )}
            {probed && check && <a className="cp-link" href="#case-check">Read the chat ↓</a>}
          </>
        )}
      </div>
    </div>
  );
}
