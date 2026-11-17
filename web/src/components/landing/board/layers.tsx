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
    said: "His answer to problem 5 is right, but he showed no steps, so one point off under Ms. Rivera's rule, and a draft grade of 9 out of 10 that Jordan can't see yet.",
    body: "Write your grading rules once for the class. Every point Veradic takes off says why, and whether it came from your rule or its own judgment.",
  },
  {
    title: "The understanding check",
    said: "Veradic asked Jordan how he got from 22 to 15. He answered: took 7 off both sides.",
    body: "A short conversation about the student's own steps. You can read every word of it.",
  },
  {
    title: "You approve",
    said: "All four layers: Jordan's handwritten work; one point off under Ms. Rivera's rule, for 9 out of 10; his answer in the understanding check, took 7 off both sides; and her approval, not published yet.",
    body: "Nothing reaches a student until you approve and publish it. Change any point in one click.",
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

    // Below the fold: rest on the bare homework until it scrolls into view,
    // so the finished page never shows and then gets wiped. (In a frame
    // callback, not synchronously in the effect.)
    const frame = requestAnimationFrame(() => setStep(1));
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
      cancelAnimationFrame(frame);
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
                // Stacked layout: the sheet is below the steps, so bring it
                // into view or the tap looks like it did nothing.
                // Scroll to the part this step adds (step 1 is the sheet
                // itself), centred, so it's on screen even on short phones.
                const sheet = sheetRef.current;
                if (sheet && window.matchMedia("(max-width: 960px)").matches) {
                  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                  const target =
                    i === 0 ? sheet : sheet.querySelector<HTMLElement>(`[data-focus-step="${i + 1}"]`) ?? sheet;
                  target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: i === 0 ? "start" : "center" });
                }
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
        <div className={`${s.row} ${s.rowSmall}`}>Jordan P. &mdash; Alg II, HW 4.6</div>
        <div className={s.row}>4)&nbsp; 3x + 7 = 22</div>
        <div className={`${s.row} ${s.ind}`}>3x = 15 &nbsp;&nbsp; x = 5</div>
        <div className={s.row}>5)&nbsp; 2(x &minus; 4) = 10</div>
        <div className={`${s.row} ${s.ind}`}>x = 9</div>
        <div className={s.row}>6)&nbsp; 4(x + 1) = 24</div>
        <div className={`${s.row} ${s.ind}`}>4x + 4 = 24 &nbsp;&nbsp; x = 5</div>

        <div className={`${s.lay} ${s.hlYellow}`} data-on={on(3)} />
        <div className={`${s.lay} ${s.noteYellow}`} data-on={on(3)} data-focus-step="3">
          <small>Veradic asked Jordan</small>
          How did you get from 22 to 15?
          <span>took 7 off both sides</span>
        </div>
        <div className={`${s.lay} ${s.hlRed}`} data-on={on(2)} />
        <div className={`${s.lay} ${s.noteRed}`} data-on={on(2)} data-focus-step="2">
          <b>&minus;1 &middot; Class rule</b>
          Right answer, but your rule: show your work. No steps between the equation and x = 9.

        </div>
        <div className={`${s.lay} ${s.rulesCard}`} data-on={on(2)}>
          <p>Ms. Rivera&rsquo;s rules &middot; Algebra II</p>
          <ul>
            <li>Show your work &mdash; 1 pt</li>
            <li>Units on final answers &mdash; 1 pt</li>
          </ul>
        </div>
        <div className={`${s.lay} ${s.grade}`} data-on={on(2)} data-approved={step >= 4 ? "true" : "false"}>
          <span className={s.gradeScore}>9/10</span>
          <span className={s.gradeLbl}>
            {/* Both rendered; CSS shows the one that fits (and print, which
                shows every layer, always shows the approved one). */}
            <span className={s.lblApproved}>
              Approved, not
              <br />
              published yet.
            </span>
            <span className={s.lblDraft}>
              Draft. Jordan can&rsquo;t
              <br />
              see it yet.
            </span>
          </span>
        </div>
        <div className={`${s.lay} ${s.stamp}`} data-on={on(4)} data-focus-step="4">
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
