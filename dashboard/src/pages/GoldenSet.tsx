import { useMemo, useState } from "react";
import "katex/dist/katex.min.css";
import StatCard from "../components/StatCard";
import MathText from "../components/MathText";
import { loadGoldenSet, type Problem } from "../lib/golden-set";

const gs = loadGoldenSet();

type FormatFilter = "all" | "frq" | "mcq";

function courseTag(key: string) {
  return key === "geometry" ? "G" : key === "calculus" ? "C" : key[0].toUpperCase();
}

function ProblemCard({ problem, tag }: { problem: Problem; tag: string }) {
  const [open, setOpen] = useState(false);
  const verified = problem.verdict.status === "verified";
  const isMcq = problem.format === "mcq";

  return (
    <article className="gs-card">
      <header className="gs-card-head">
        <span className="gs-qnum mono">
          {tag}
          {problem.n}
        </span>
        <span className="gs-fmt">
          {problem.format.toUpperCase()} · {problem.difficulty}
        </span>
        <span className={`badge ${verified ? "badge-completed" : "badge-warning"} gs-verdict-pill`}>
          {verified ? "✓ Verified" : "⚠ Note"}
        </span>
      </header>

      <div className="gs-question">
        <MathText>{problem.question}</MathText>
      </div>

      {problem.figureSvg && (
        <div className="gs-figure" dangerouslySetInnerHTML={{ __html: problem.figureSvg }} />
      )}

      {isMcq && problem.distractors.length > 0 && (
        <div className="gs-options">
          <div className="gs-options-correct">
            <span className="gs-opt-dot" /> <MathText>{problem.finalAnswer}</MathText>
            <span className="gs-opt-tag">correct</span>
          </div>
          {problem.distractors.map((d, i) => (
            <div className="gs-options-distractor" key={i}>
              <span className="gs-opt-dot gs-opt-dot-off" /> <MathText>{d}</MathText>
            </div>
          ))}
        </div>
      )}

      <button className="gs-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : "Show"} worked solution
        <span className={`gs-chevron ${open ? "open" : ""}`}>›</span>
      </button>

      {open && (
        <ol className="gs-steps">
          {problem.solutionSteps.map((s, i) => (
            <li key={i} className="gs-step">
              <div className="gs-step-title">{s.title}</div>
              <div className="gs-step-body">
                <MathText>{s.description}</MathText>
              </div>
            </li>
          ))}
        </ol>
      )}

      {!isMcq && (
        <div className="gs-answer">
          <span className="gs-answer-label">Answer</span>
          <MathText>{problem.finalAnswer}</MathText>
        </div>
      )}

      <div className={`gs-verdict ${verified ? "is-verified" : "is-note"}`}>
        <div className="gs-verdict-label">Independent re-derivation</div>
        <div className="gs-rederiv">
          <MathText>{problem.verdict.rederivation}</MathText>
        </div>
        <div className="gs-note">{problem.verdict.note}</div>
      </div>
    </article>
  );
}

export default function GoldenSet() {
  const [courseKey, setCourseKey] = useState(gs.courses[0]?.key ?? "");
  const [fmt, setFmt] = useState<FormatFilter>("all");

  const course = useMemo(
    () => gs.courses.find((c) => c.key === courseKey) ?? gs.courses[0],
    [courseKey],
  );

  const problems = useMemo(
    () => course.problems.filter((p) => fmt === "all" || p.format === fmt),
    [course, fmt],
  );

  return (
    <div className="gs-page">
      <header className="page-header">
        <span className="eyebrow">Diagnostics · Quality benchmark</span>
        <h1>{gs.meta.title}</h1>
        <p>{gs.meta.subtitle}</p>
        <p className="gs-intro">{gs.meta.intro}</p>
        <div className="gs-meta-line mono">
          {gs.meta.teacher} · model {gs.meta.model} · captured {gs.meta.capturedAt}
        </div>
      </header>

      <div className="stat-grid gs-stats">
        {gs.meta.stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
        ))}
      </div>

      {/* Verified problems */}
      <section className="gs-section">
        <h2>Verified problems</h2>
        <p className="gs-section-sub">
          Every generated problem re-derived by hand — answer and reasoning checked.
        </p>

        <div className="gs-filters">
          <div className="gs-tabs">
            {gs.courses.map((c) => (
              <button
                key={c.key}
                className={`gs-tab ${c.key === courseKey ? "active" : ""}`}
                onClick={() => setCourseKey(c.key)}
              >
                {c.name}
                <span className="gs-tab-sub">{c.unit}</span>
              </button>
            ))}
          </div>
          <div className="gs-fmt-filter">
            {(["all", "frq", "mcq"] as FormatFilter[]).map((f) => (
              <button
                key={f}
                className={`gs-chip ${fmt === f ? "active" : ""}`}
                onClick={() => setFmt(f)}
              >
                {f === "all" ? "All" : f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="gs-grid">
          {problems.map((p) => (
            <ProblemCard key={p.n} problem={p} tag={courseTag(course.key)} />
          ))}
        </div>
      </section>

      <hr className="hr" />

      {/* The flow */}
      <section className="gs-section">
        <h2>The flow</h2>
        <p className="gs-section-sub">
          How a teacher goes from her own worksheet to a published, reviewed assignment.
        </p>

        <div className="gs-video-wrap">
          <video className="gs-video" src={gs.recording} controls preload="metadata" />
          <div className="gs-video-cap mono">Full run · generate → review → AI-edit → approve</div>
        </div>

        <ol className="gs-flow">
          {gs.flow.map((shot, i) => (
            <li className="gs-flow-step" key={shot.src}>
              <div className="gs-flow-num mono">{String(i + 1).padStart(2, "0")}</div>
              <figure className="gs-flow-fig">
                <img src={shot.src} alt={shot.caption} loading="lazy" />
                <figcaption>{shot.caption}</figcaption>
              </figure>
            </li>
          ))}
        </ol>
      </section>

      <hr className="hr" />

      {/* What we found */}
      <section className="gs-section">
        <h2>What we found</h2>
        <p className="gs-section-sub">
          Stress-testing the review tools surfaced two real bugs — both fixed in this run.
        </p>

        <div className="gs-findings">
          {gs.findings.map((f) => (
            <article className="gs-finding" key={f.title}>
              <header className="gs-finding-head">
                <span className="gs-finding-sev">{f.severity}</span>
                <span className="gs-finding-title">{f.title}</span>
                <span className="badge badge-completed gs-fixed">{f.status}</span>
              </header>
              <div className="gs-ba">
                <div className="gs-ba-col is-before">
                  <div className="gs-ba-label">Before</div>
                  <p>{f.before}</p>
                </div>
                <div className="gs-ba-arrow">→</div>
                <div className="gs-ba-col is-after">
                  <div className="gs-ba-label">After</div>
                  <p>{f.after}</p>
                </div>
              </div>
              <div className="gs-finding-detail mono">{f.detail}</div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
