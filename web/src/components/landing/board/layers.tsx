"use client";

import { useEffect, useRef, useState } from "react";
import s from "./home.module.css";

/**
 * How it works: one homework page and the four layers Veradic puts on it.
 * The last layer, the teacher's approval, is always the teacher's.
 *
 * Rests on the finished page (all four layers), so the server render and a
 * reduced-motion visitor see everything. When it first scrolls into view it
 * builds once, layer by layer; a click on any step stops the build there.
 */
const STEPS = [
  {
    title: "The student's own work",
    said: "Jordan's handwritten homework, before Veradic adds anything.",
    body: "A phone photo of real handwritten homework. Veradic reads every line of the work, not just the final answer.",
  },
  {
    title: "Graded by your rules",
    said: "A point taken off under Ms. Rivera's rule, and a draft grade of 8 out of 10 that Jordan can't see yet.",
    body: "Write your grading rules once for the class. Every point Veradic takes off says why, and whether it came from your rule or its own judgment.",
  },
  {
    title: "The understanding check",
    said: "Veradic asked Jordan how he got from 22 to 15. He answered: took 7 off both sides.",
    body: "A short conversation about the student's own steps. You can read every word of it.",
  },
  {
    title: "You approve",
    said: "Ms. Rivera approved the grade, with every layer above still visible.",
    body: "Nothing reaches a student until you approve it. Change any point in one click.",
  },
];

export function Layers() {
  const [step, setStep] = useState(4);
  // Only a step the visitor picked is announced; the automatic build is silent.
  const [chosen, setChosen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const observer = useRef<IntersectionObserver | null>(null);
  const stopBuild = () => {
    observer.current?.disconnect();
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    const el = sheetRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setStep(1);
        [2, 3, 4].forEach((n, i) => timers.current.push(window.setTimeout(() => setStep(n), 1500 * (i + 1))));
      },
      { threshold: 0.35 },
    );
    observer.current = io;
    io.observe(el);
    return () => {
      io.disconnect();
      stopBuild();
    };
  }, []);

  const on = (n: number) => (step >= n ? "true" : "false");

  return (
    <div className={s.layersGrid}>
      <ul className={s.steps} aria-label="Layers of a graded homework">
        {STEPS.map((st, i) => (
          <li key={st.title}>
            <button
              type="button"
              aria-pressed={step === i + 1}
              aria-controls="layers-sheet"
              className={s.stepBtn}
              onClick={() => {
                stopBuild();
                setStep(i + 1);
                setChosen(true);
              }}
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
        aria-label={`Example, layer ${step} of 4: ${STEPS[step - 1].said}`}
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
      <p className="sr-only" aria-live="polite">
        {chosen ? `Layer ${step} of 4: ${STEPS[step - 1].said}` : ""}
      </p>
    </div>
  );
}
