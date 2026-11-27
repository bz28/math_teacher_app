import StatusPill, { type PillTone } from "./StatusPill";
import MathText from "./MathText";
import { formatRelativeDate } from "../lib/format";
import type { CaseIntegrity, CaseTurn, SubmissionCase } from "../lib/caseFile";

// The understanding check, whole: the conversation as the student had
// it, with the agent's decisions (its tool calls) in place — the moment
// it recorded a verdict or closed the check is visible in the thread —
// and how the teacher resolved it.

const DISPOSITION: Record<string, { tone: PillTone; label: string }> = {
  pass: { tone: "ok", label: "PASS" },
  needs_practice: { tone: "warn", label: "NEEDS PRACTICE" },
  tutor_pivot: { tone: "warn", label: "TUTOR PIVOT" },
  flag_for_review: { tone: "danger", label: "FLAG FOR REVIEW" },
};

const INCOMPLETE: Record<string, string> = {
  not_started: "The student never answered the check",
  left_partway: "The student left partway through",
  turn_cap: "Hit the turn cap before a verdict",
};

const words = (s: unknown) => String(s ?? "").replace(/_/g, " ");

function seconds(n: number): string {
  return n < 90 ? `${n}s` : `${Math.round(n / 60)}m`;
}

/** What one tool call decided, as a line: "Verdict · P2 · causal low". */
function toolLine(t: CaseTurn, positionOf: Map<string, number>): string {
  const input = t.tool_input ?? {};
  switch (t.tool_name) {
    case "submit_problem_verdict": {
      const pos = positionOf.get(String(input.problem_id));
      const rubric = (input.rubric ?? {}) as Record<string, unknown>;
      const parts = Object.entries(rubric).map(([k, v]) => `${words(k)} ${words(v)}`);
      return ["Recorded a verdict", pos ? `P${pos}` : null, ...parts].filter(Boolean).join(" · ");
    }
    case "finish_check":
      return ["Closed the check", words(input.disposition), input.headline ? `"${String(input.headline)}"` : null]
        .filter(Boolean).join(" · ");
    case "label_student_reply":
      return `Labelled the reply: ${words(input.engagement)}`;
    default:
      return words(t.tool_name ?? "tool call");
  }
}

function Telemetry({ t }: { t: CaseTurn }) {
  const tel = t.telemetry ?? {};
  const blur = Array.isArray(tel.focus_blur_events) ? tel.focus_blur_events.length : 0;
  const paste = Array.isArray(tel.paste_events) ? tel.paste_events.length : 0;
  const bits = [
    t.seconds_on_turn != null ? `${seconds(t.seconds_on_turn)} on this reply` : null,
    blur ? `${blur} tab-out${blur === 1 ? "" : "s"}` : null,
    paste ? `${paste} paste${paste === 1 ? "" : "s"}` : null,
    t.engagement ? words(t.engagement) : null,
  ].filter(Boolean);
  if (bits.length === 0) return null;
  return <div className="cc-tel">{bits.join(" · ")}</div>;
}

export default function CaseCheck({ data }: { data: SubmissionCase }) {
  const check = data.integrity;
  if (!check) return null;
  const positionOf = new Map(
    data.problems.filter((p) => p.integrity).map((p) => [p.integrity!.problem_id, p.position]),
  );
  const disp = check.disposition ? DISPOSITION[check.disposition] : null;
  return (
    <section className="cc" id="case-check" aria-labelledby="cc-title">
      <div className="cc-head">
        <h3 id="cc-title" className="cp-title">Understanding check</h3>
        {disp ? (
          <StatusPill tone={disp.tone} label={disp.label} />
        ) : (
          <StatusPill tone="neutral" label={words(check.status).toUpperCase()} />
        )}
        {check.headline && <span className="cc-headline">{check.headline}</span>}
      </div>
      <Resolution check={check} />
      {check.overall_summary && <p className="cc-summary">{check.overall_summary}</p>}
      <dl className="cc-meta">
        <dt>Briefed as</dt><dd>{words(check.posture)} · tier {words(check.tier)}</dd>
        {check.probe_selection_reason && (<><dt>Picked</dt><dd>{words(check.probe_selection_reason)}</dd></>)}
        {check.incomplete_reason && (<><dt>Ended</dt><dd>{INCOMPLETE[check.incomplete_reason] ?? words(check.incomplete_reason)}</dd></>)}
        {check.inline_variant_used && (<><dt>Variant</dt><dd>{words(check.inline_variant_result ?? "asked")}</dd></>)}
      </dl>
      {check.turns.length === 0 ? (
        <p className="cp-muted">No conversation yet.</p>
      ) : (
        <ol className="cc-thread">
          {check.turns.map((t) => (
            <Turn key={t.ordinal} t={t} positionOf={positionOf} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Resolution({ check }: { check: CaseIntegrity }) {
  if (check.resolution === "unresolved" || !check.resolution) {
    return <p className="cc-resolution cp-muted">Teacher hasn't resolved it.</p>;
  }
  return (
    <p className="cc-resolution">
      Teacher resolution: <strong>{words(check.resolution)}</strong>
      {check.resolved_by_name && <> by {check.resolved_by_name}</>}
      {check.resolved_at && <span className="cp-muted" title={check.resolved_at}> · {formatRelativeDate(check.resolved_at)}</span>}
    </p>
  );
}

function Turn({ t, positionOf }: { t: CaseTurn; positionOf: Map<string, number> }) {
  if (t.role === "tool_call") {
    return (
      <li className="cc-event">
        <span className="cc-event-mark" aria-hidden="true">◆</span>
        <span className="cc-event-text">{toolLine(t, positionOf)}</span>
        {t.tool_name === "submit_problem_verdict" && typeof t.tool_input?.reasoning === "string" && (
          <span className="cc-event-why">{t.tool_input.reasoning}</span>
        )}
      </li>
    );
  }
  if (t.role === "tool_result") {
    return <li className="cc-result">{t.content}</li>;
  }
  if (t.role === "agent_note") {
    return (
      <li className="cc-msg cc-msg-note">
        <span className="cc-who">Agent note · not shown to the student</span>
        <p><MathText>{t.content}</MathText></p>
      </li>
    );
  }
  const student = t.role === "student";
  return (
    <li className={`cc-msg ${student ? "cc-msg-student" : "cc-msg-agent"}`}>
      <span className="cc-who">{student ? "Student" : "Agent"}</span>
      <p><MathText>{t.content}</MathText></p>
      {student && <Telemetry t={t} />}
    </li>
  );
}
