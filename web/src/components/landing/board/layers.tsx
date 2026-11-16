"use client";

import { useEffect, useRef, useState } from "react";
import s from "./home.module.css";

/**
 * How it works: one homework page and the four layers Veradic puts on it.
 * The last layer, the teacher's approval, is always the teacher's.
 *
 * Rests on the finished page (all four layers), so the server render and a
 * reduced-motion visitor see everything. When it first scrolls into view it
 * builds once, layer by layer; the steps are real tabs after that.
 */
const STEPS = [
  {
    title: "The student's own work",
    body: "A phone photo of real handwritten homework. Veradic reads every line of the work, not just the final answer.",
  },
  {
    title: "Graded by your rules",
    body: "Write your grading rules once for the class. Every point Veradic takes off says why, and whether it came from your rule or its own judgment.",
  },
  {
    title: "The understanding check",
    body: "A short conversation about the student's own steps. You can read every word of it.",
  },
  {
    title: "You approve",
    body: "Nothing reaches a student until you approve it. Change any point in one click.",
  },
];

export function Layers() {
  const [step, setStep] = useState(4);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    const timers: number[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setStep(1);
        [2, 3, 4].forEach((n, i) => timers.push(window.setTimeout(() => setStep(n), 1500 * (i + 1))));
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  const on = (n: number) => (step >= n ? "true" : "false");

  return (
    <div className={s.layersGrid}>
      <ul className={s.steps} role="tablist" aria-label="Layers of a graded homework">
        {STEPS.map((st, i) => (
          <li key={st.title} role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={step === i + 1}
              aria-controls="layers-sheet"
              className={s.stepBtn}
              onClick={() => setStep(i + 1)}
            >
              <span className={s.stepN}>{i + 1}</span>
              <span>
                <span className={s.stepT}>{st.title}</span>
                <span className={s.stepD}>{st.body}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div
        id="layers-sheet"
        ref={sheetRef}
        className={s.sheet}
        role="img"
        aria-label="Example: Jordan's homework with Veradic's layers. A point taken off under the teacher's rule, the understanding-check exchange, a draft grade of 8 out of 10, and the teacher's approval stamp."
      >
        <div className={`${s.row} ${s.rowSmall}`}>Jordan P. &mdash; Alg II, HW 5.2</div>
        <div className={s.row}>4)&nbsp; 3x + 7 = 22</div>
        <div className={`${s.row} ${s.ind}`}>3x = 15 &nbsp;&nbsp; x = 5</div>
        <div className={s.row}>5)&nbsp; 2(x &minus; 4) = 10</div>
        <div className={`${s.row} ${s.ind}`}>2x &minus; 4 = 10 &nbsp;&nbsp; x = 7</div>
        <div className={s.row}>6)&nbsp; 4(x + 1) = 24</div>
        <div className={`${s.row} ${s.ind}`}>4x + 4 = 24 &nbsp;&nbsp; x = 5</div>

        <div className={`${s.lay} ${s.hlYellow}`} data-on={on(3)} />
        <div className={`${s.lay} ${s.noteYellow}`} data-on={on(3)}>
          <small>Veradic asked Jordan</small>
          How did you get from 22 to 15?
          <span>took 7 off both sides</span>
        </div>
        <div className={`${s.lay} ${s.hlRed}`} data-on={on(2)} />
        <div className={`${s.lay} ${s.noteRed}`} data-on={on(2)}>
          <b>&minus;1 &middot; From your rule</b>
          Show the distribution: the 2 multiplies both terms.
        </div>
        <div className={`${s.lay} ${s.rulesCard}`} data-on={on(2)}>
          <p>Ms. Rivera&rsquo;s rules &middot; Algebra II</p>
          <ul>
            <li>Show the distribution &mdash; 1 pt</li>
            <li>Units on final answers &mdash; 1 pt</li>
          </ul>
        </div>
        <div className={`${s.lay} ${s.grade}`} data-on={on(2)}>
          <span className={s.gradeScore}>8/10</span>
          <span className={s.gradeLbl}>
            Draft. Jordan can&rsquo;t
            <br />
            see it yet.
          </span>
        </div>
        <div className={`${s.lay} ${s.stamp}`} data-on={on(4)}>
          Approved
          <small>Ms. Rivera &middot; Mon 7:42 am</small>
        </div>
      </div>
    </div>
  );
}
