import { useId, useMemo, useState } from "react";

// Interactive, honest time-saved model. NOT a measured-outcome claim — it's a
// transparent calculation the buyer drives from their own inputs, with every
// step of the arithmetic shown. Veradic grades everything; the teacher reviews
// only the flagged/uncertain share they choose. Hours back = the difference.
//
//   hand-grading   = students × assignments × minutes ÷ 60   (hrs / week)
//   with Veradic   = hand-grading × review-share
//   hours back     = hand-grading − with Veradic
//
// At the defaults (30 × 3 × 8 ÷ 60 = 12.0 hrs, × 20% reviewed = 2.4 hrs) the
// teacher gets ≈ 10 hours back every week.

type FieldKey = "students" | "assignments" | "minutes" | "review";

type Field = {
  key: FieldKey;
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
  minutes: 8,
  review: 20,
};

const FIELDS: Field[] = [
  {
    key: "students",
    label: "Students per class",
    hint: "every one gets checked",
    min: 5,
    max: 45,
    step: 1,
    format: (v) => `${v}`,
  },
  {
    key: "assignments",
    label: "Graded assignments per week",
    hint: "homework, quizzes, exit tickets",
    min: 1,
    max: 10,
    step: 1,
    format: (v) => `${v}`,
  },
  {
    key: "minutes",
    label: "Minutes to hand-grade one paper",
    hint: "marking and reading the work",
    min: 1,
    max: 20,
    step: 1,
    format: (v) => `${v} min`,
  },
  {
    key: "review",
    label: "Share you spot-review",
    hint: "Veradic grades all of it; you check this slice",
    min: 0,
    max: 100,
    step: 5,
    format: (v) => `${v}%`,
  },
];

const round1 = (n: number) => Math.round(n * 10) / 10;
const hrs = (n: number) => n.toFixed(1);

export default function RoiCalculator() {
  const [vals, setVals] = useState<Record<FieldKey, number>>(DEFAULTS);
  const baseId = useId();

  const { hand, withVeradic, back, headline } = useMemo(() => {
    // Round each operand to 1 decimal ONCE, then derive the next value from the
    // value the buyer actually sees — so every printed line (breakdown rows AND
    // the literal equations) is internally consistent at every slider position:
    //   displayed hand − displayed withVeradic === displayed back, always.
    const hand = round1((vals.students * vals.assignments * vals.minutes) / 60);
    const withVeradic = round1(hand * (vals.review / 100));
    const back = round1(hand - withVeradic);
    return { hand, withVeradic, back, headline: Math.round(back) };
  }, [vals]);

  return (
    <div className="it-roi">
      <div className="it-roi-card">
        {/* ── Controls — the buyer's own numbers ──────────────── */}
        <div className="it-roi-controls">
          {FIELDS.map((f) => {
            const id = `${baseId}-${f.key}`;
            const v = vals[f.key];
            const pct = ((v - f.min) / (f.max - f.min)) * 100;
            return (
              <div className="it-roi-field" key={f.key}>
                <div className="it-roi-field-head">
                  <label htmlFor={id} className="it-roi-field-label">
                    {f.label}
                  </label>
                  <span className="it-roi-field-val mono">{f.format(v)}</span>
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
                    setVals((s) => ({ ...s, [f.key]: Number(e.target.value) }))
                  }
                />
                <span className="it-roi-field-hint">{f.hint}</span>
              </div>
            );
          })}
        </div>

        {/* ── Live readout — ink panel, the number that lands ──── */}
        <div className="it-roi-readout" aria-live="polite">
          <div className="it-roi-headline">
            <span className="it-roi-headline-num mono">&asymp;&nbsp;{headline}</span>
            <span className="it-roi-headline-unit">
              hours back,
              <br />
              every week
            </span>
          </div>

          <div className="it-roi-breakdown">
            <div className="it-roi-line">
              <span className="it-roi-line-label">Grading by hand</span>
              <span className="it-roi-line-val mono">{hrs(hand)} hrs / wk</span>
            </div>
            <div className="it-roi-line">
              <span className="it-roi-line-label">With Veradic, you review {vals.review}%</span>
              <span className="it-roi-line-val mono">{hrs(withVeradic)} hrs / wk</span>
            </div>
            <div className="it-roi-line it-roi-line-back">
              <span className="it-roi-line-label">Hours back</span>
              <span className="it-roi-line-val mono">{hrs(back)} hrs / wk</span>
            </div>
          </div>

          <div className="it-roi-formula mono" aria-hidden="true">
            <span>
              {vals.students} &times; {vals.assignments} &times; {vals.minutes} &divide; 60 ={" "}
              {hrs(hand)}
            </span>
            <span>
              {hrs(hand)} &times; {vals.review}% = {hrs(withVeradic)}
            </span>
            <span>
              {hrs(hand)} &minus; {hrs(withVeradic)} = <strong>{hrs(back)}</strong>
            </span>
          </div>
        </div>
      </div>

      <p className="it-roi-foot">
        Your inputs &times; the math shown &mdash; a calculation you control, not a measured claim.
        Pre-launch: we report production results once we have them.
      </p>
    </div>
  );
}
