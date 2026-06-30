import { useId, useMemo, useState } from "react";

// Interactive, honest time-saved model. NOT a measured-outcome claim — it's a
// transparent calculation the buyer drives from their own inputs, with every
// step shown. It quantifies the two RECURRING, measurable time sinks Veradic
// shrinks — building assignments and grading — where the honest lever is "a
// quick review of the AI's work beats doing it from scratch." Integrity audits
// and class insights are NOT quantified as hours (they're episodic / net-new);
// they're presented below as the data you simply didn't have before.
//
//   make  saved = assignments            × (build − review) ÷ 60   (hrs / week)
//   grade saved = students × assignments × (grade − review) ÷ 60   (hrs / week)
//   hours back  = make saved + grade saved
//
// At the defaults: make 3×(25−5)÷60 = 1.0, grade 30×3×(8−2)÷60 = 9.0 → 10 hrs.

type FieldKey =
  | "students"
  | "assignments"
  | "practiceSets"
  | "makeBuild"
  | "makeReview"
  | "gradeBuild"
  | "gradeReview";

type Field = {
  key: FieldKey;
  group: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
};

const DEFAULTS: Record<FieldKey, number> = {
  students: 30,
  assignments: 3,
  practiceSets: 2,
  makeBuild: 25,
  makeReview: 5,
  gradeBuild: 8,
  gradeReview: 2,
};

const FIELDS: Field[] = [
  {
    key: "students",
    group: "Your class",
    label: "Students per class",
    hint: "every one gets checked",
    min: 5,
    max: 45,
    step: 1,
    format: (v) => `${v}`,
  },
  {
    key: "assignments",
    group: "Your class",
    label: "Graded assignments per week",
    hint: "homework, quizzes, exit tickets",
    min: 1,
    max: 10,
    step: 1,
    format: (v) => `${v}`,
  },
  {
    key: "practiceSets",
    group: "Your class",
    label: "Practice / reteach sets per week",
    hint: "auto-checked, so created — not graded",
    min: 0,
    max: 10,
    step: 1,
    format: (v) => `${v}`,
  },
  {
    key: "makeBuild",
    group: "Building one set (homework or practice)",
    label: "By hand",
    hint: "finding/writing the problems + answer key",
    min: 5,
    max: 45,
    step: 5,
    format: (v) => `${v} min`,
  },
  {
    key: "makeReview",
    group: "Building one set (homework or practice)",
    label: "Reviewing a generated one",
    hint: "Veradic writes + checks it; you approve",
    min: 1,
    max: 15,
    step: 1,
    format: (v) => `${v} min`,
  },
  {
    key: "gradeBuild",
    group: "Grading one paper",
    label: "By hand",
    hint: "marking and reading the work from scratch",
    min: 2,
    max: 20,
    step: 1,
    format: (v) => `${v} min`,
  },
  {
    key: "gradeReview",
    group: "Grading one paper",
    label: "Reviewing an AI-graded one",
    hint: "a quick check of Veradic's work",
    min: 1,
    max: 10,
    step: 1,
    format: (v) => `${v} min`,
  },
];

const GROUPS = [
  "Your class",
  "Building one set (homework or practice)",
  "Grading one paper",
];

const round1 = (n: number) => Math.round(n * 10) / 10;
const hrs = (n: number) => n.toFixed(1);

export default function RoiCalculator() {
  const [vals, setVals] = useState<Record<FieldKey, number>>(DEFAULTS);
  const baseId = useId();

  const { makeSave, gradeSave, back, setsMade, makeRev, gradeRev, headline } =
    useMemo(() => {
      // A review can't honestly take longer than doing the task from scratch —
      // clamp so the model never claims a saving that runs backwards.
      const makeRev = Math.min(vals.makeReview, vals.makeBuild);
      const gradeRev = Math.min(vals.gradeReview, vals.gradeBuild);
      // Round each bucket's saving to 1 decimal ONCE; the total is their sum, so
      // every printed line stays internally consistent: make + grade === back.
      // Veradic generates homework AND practice/reteach sets — both count
      // toward creation time saved (practice is auto-checked, so it never
      // reaches the grading bucket).
      const setsMade = vals.assignments + vals.practiceSets;
      const makeSave = round1((setsMade * (vals.makeBuild - makeRev)) / 60);
      const gradeSave = round1(
        (vals.students * vals.assignments * (vals.gradeBuild - gradeRev)) / 60,
      );
      const back = round1(makeSave + gradeSave);
      return {
        makeSave,
        gradeSave,
        back,
        setsMade,
        makeRev,
        gradeRev,
        headline: Math.round(back),
      };
    }, [vals]);

  return (
    <div className="it-roi">
      <div className="it-roi-card">
        {/* ── Controls — the buyer's own numbers ──────────────── */}
        <div className="it-roi-controls">
          {GROUPS.map((group) => (
            <div className="it-roi-group" key={group}>
              <p className="it-roi-group-head">{group}</p>
              {FIELDS.filter((f) => f.group === group).map((f) => {
                const id = `${baseId}-${f.key}`;
                const v = vals[f.key];
                const pct = ((v - f.min) / (f.max - f.min)) * 100;
                return (
                  <div className="it-roi-field" key={f.key}>
                    <div className="it-roi-field-head">
                      <label htmlFor={id} className="it-roi-field-label">
                        {f.label}
                      </label>
                      <span className="it-roi-field-val mono">
                        {f.format(v)}
                      </span>
                    </div>
                    <input
                      id={id}
                      className="it-roi-slider"
                      type="range"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={v}
                      style={{ ["--fill" as string]: `${pct}%` }}
                      aria-valuetext={f.format(v)}
                      onChange={(e) =>
                        setVals((s) => ({
                          ...s,
                          [f.key]: Number(e.target.value),
                        }))
                      }
                    />
                    <span className="it-roi-field-hint">{f.hint}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Live readout — ink panel, the number that lands ──── */}
        <div className="it-roi-readout" aria-live="polite">
          <div className="it-roi-headline">
            <span className="it-roi-headline-num mono">
              &asymp;&nbsp;{headline}
            </span>
            <span className="it-roi-headline-unit">
              hours back,
              <br />
              every week
            </span>
          </div>

          <div className="it-roi-breakdown">
            <div className="it-roi-line">
              <span className="it-roi-line-label">
                Making homework + practice
              </span>
              <span className="it-roi-line-val mono">
                +{hrs(makeSave)} hrs / wk
              </span>
            </div>
            <div className="it-roi-line">
              <span className="it-roi-line-label">Grading + feedback</span>
              <span className="it-roi-line-val mono">
                +{hrs(gradeSave)} hrs / wk
              </span>
            </div>
            <div className="it-roi-line it-roi-line-back">
              <span className="it-roi-line-label">Hours back</span>
              <span className="it-roi-line-val mono">{hrs(back)} hrs / wk</span>
            </div>
          </div>

          <div className="it-roi-formula mono" aria-hidden="true">
            <span>
              make: {setsMade} &times; ({vals.makeBuild}&minus;{makeRev})
              &divide; 60 = {hrs(makeSave)}
            </span>
            <span>
              grade: {vals.students} &times; {vals.assignments} &times; (
              {vals.gradeBuild}&minus;{gradeRev}) &divide; 60 = {hrs(gradeSave)}
            </span>
            <span>
              = <strong>{hrs(back)}</strong> hrs back / week
            </span>
          </div>
        </div>
      </div>

      {/* ── And the data you never had — not hours, capability ── */}
      <div className="it-roi-data">
        <p className="it-roi-data-head">And the data you didn&rsquo;t have before</p>
        <div className="it-roi-data-row">
          <span className="it-roi-data-item">
            <strong>Integrity, on the record.</strong> When a parent asks why a
            kid aces homework but fails tests, every submission&rsquo;s
            understanding was already checked &mdash; the afternoon-long audit is
            already done.
          </span>
          <span className="it-roi-data-item">
            <strong>Who&rsquo;s slipping, and what to reteach.</strong> The data
            to see exactly which students are falling behind and which concept
            the class missed &mdash; before the test gets there first.
          </span>
        </div>
      </div>

      <p className="it-roi-foot">
        Your inputs &times; the math shown &mdash; a calculation you control, not a
        measured claim. The lever is simple: checking the AI&rsquo;s work is faster
        than doing it from scratch. Pre-launch: we report production results once
        we have them.
      </p>
    </div>
  );
}
