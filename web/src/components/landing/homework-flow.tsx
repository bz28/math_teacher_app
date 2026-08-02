"use client";

/**
 * The homework flow — an animated, click-through tour of the real teacher
 * workflow: Generate (from your own materials) → Review → Refine (AI chat that
 * edits both the question AND the solution) → Publish. Math renders with the
 * product's own KaTeX; the worked solution is the real platform output.
 *
 * Auto-loops; click any step to pause and replay it. Honors reduced motion by
 * resting on the published result with the steps still clickable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MathText } from "@/components/shared/math-text";

const SERIF = "var(--font-instrument-serif)";
const EASE = [0.22, 1, 0.36, 1] as const;
const FOCUS_TEXT = "matrix methods, mixed difficulty";
const STAGES = ["Generate", "Review", "Refine", "Publish"] as const;

type Diff = "Easy" | "Medium" | "Hard";
type Prob = { q: string; d: Diff };
const PROBLEMS: Prob[] = [
  { q: String.raw`Solve $A\mathbf{x}=\mathbf{b}$ for $A=\begin{bmatrix}2&1\\1&-1\end{bmatrix}$, $\mathbf{b}=\begin{bmatrix}5\\1\end{bmatrix}$`, d: "Medium" },
  { q: String.raw`Solve the system: $x+2y=4,\ \ 3x-y=5$`, d: "Easy" },
  { q: String.raw`Find $A^{-1}$ for $A=\begin{bmatrix}3&2\\1&1\end{bmatrix}$`, d: "Medium" },
  { q: String.raw`Solve: $\begin{bmatrix}1&-1\\2&1\end{bmatrix}\mathbf{x}=\begin{bmatrix}0\\6\end{bmatrix}$`, d: "Hard" },
];

type Step = { t: string; b: string };
type ProblemData = { q: string; sol: Step[]; ans: string; d: Diff };
// The "before" solution is the REAL platform output (POST /v1/session), condensed.
const REFINE_BEFORE: ProblemData = {
  q: String.raw`Solve $A\mathbf{x}=\mathbf{b}$ for $A=\begin{bmatrix}2&1\\1&-1\end{bmatrix}$, $\mathbf{b}=\begin{bmatrix}5\\1\end{bmatrix}$`,
  sol: [
    { t: "Find the determinant", b: String.raw`$\det(A)=(2)(-1)-(1)(1)=-3\neq 0$, so the inverse exists and the system has a unique solution.` },
    { t: "Compute the inverse", b: String.raw`$A^{-1}=\frac{1}{-3}\begin{pmatrix}-1&-1\\-1&2\end{pmatrix}=\begin{pmatrix}\frac{1}{3}&\frac{1}{3}\\[4pt]\frac{1}{3}&-\frac{2}{3}\end{pmatrix}$` },
    { t: "Solve & verify", b: String.raw`$X=A^{-1}B\Rightarrow (x,y)=(2,1)$. Check: 2(2)+1 = 5 ✓ and 2−1 = 1 ✓` },
  ],
  ans: String.raw`$(x,\,y)=(2,\,1)$`,
  d: "Medium",
};
const REFINE_AFTER: ProblemData = {
  q: String.raw`Solve $A\mathbf{x}=\mathbf{b}$ for $A=\begin{bmatrix}2&1\\4&2\end{bmatrix}$, $\mathbf{b}=\begin{bmatrix}5\\3\end{bmatrix}$`,
  sol: [
    { t: "Find the determinant", b: String.raw`$\det(A)=(2)(2)-(1)(4)=0$, so $A$ is singular — no inverse exists.` },
    { t: "Check consistency", b: String.raw`Row 2 is $2\times$ Row 1 on the left, but $3\neq 2(5)$ on the right — the equations contradict.` },
  ],
  ans: `No solution — the system is inconsistent.`,
  d: "Hard",
};

const DIFF: Record<Diff, { bg: string; fg: string }> = {
  Easy: { bg: "#E8EAD9", fg: "#4A6B3A" },
  Medium: { bg: "#F5E8C7", fg: "#8C5610" },
  Hard: { bg: "#F0D7D1", fg: "#8A2317" },
};

export function HomeworkFlow() {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState(reduce ? 3 : 0);
  const [seq, setSeq] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const paused = useRef(false);
  const timers = useRef<number[]>([]);
  const playRef = useRef<(() => void) | null>(null);

  const play = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (paused.current) return;
    const dur = [5400, 4400, 7800, 5000];
    let t = 0;
    [0, 1, 2, 3, 0].forEach((s, i) => {
      timers.current.push(window.setTimeout(() => setStage(s), t));
      t += dur[s];
      if (i === 3) t += 600;
    });
    // Loop via a ref so the callback doesn't reference itself before init.
    timers.current.push(window.setTimeout(() => playRef.current?.(), t));
  }, []);

  useEffect(() => {
    playRef.current = play;
  }, [play]);

  useEffect(() => {
    if (reduce) { paused.current = true; return; }
    play();
    return () => timers.current.forEach(clearTimeout);
  }, [play, reduce]);

  const jump = (i: number) => {
    paused.current = true;
    setIsPaused(true);
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStage(i);
    setSeq((n) => n + 1);
  };

  return (
    <div style={{ width: "100%", maxWidth: 600, display: "flex", flexDirection: "column", gap: 14 }}>
      <Stepper active={stage} onJump={jump} />
      <div style={{ position: "relative", minHeight: 508, background: "#FFFFFF", borderRadius: 18, boxShadow: "0 36px 90px -40px rgba(0,0,0,0.5)", border: "1px solid #ECE7DA", overflow: "hidden" }}>
        <AnimatePresence mode="wait">
          {stage === 0 && <Pane key={`gen-${seq}`}><GenerateStage /></Pane>}
          {stage === 1 && <Pane key={`rev-${seq}`}><ReviewStage /></Pane>}
          {stage === 2 && <Pane key={`ref-${seq}`}><RefineStage /></Pane>}
          {stage === 3 && <Pane key={`pub-${seq}`}><PublishStage /></Pane>}
        </AnimatePresence>
      </div>
      <div style={{ textAlign: "center", fontSize: 11.5, color: "#A89F8C" }}>
        {isPaused ? "Click a step to replay it" : "Click any step to explore it"}
      </div>
    </div>
  );
}

function Stepper({ active, onJump }: { active: number; onJump: (i: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
      {STAGES.map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={() => onJump(i)} style={{ background: "none", border: "none", cursor: "pointer", padding: "3px 5px", fontSize: 12.5, fontFamily: "inherit", fontWeight: i === active ? 700 : 500, color: i === active ? "#0E5238" : "#A89F8C", transition: "color 0.25s" }}>
            {i + 1}. {s}
          </button>
          {i < STAGES.length - 1 && <span style={{ color: "#D8D0BF", fontSize: 12 }}>→</span>}
        </div>
      ))}
    </div>
  );
}

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.42, ease: EASE }} style={{ position: "absolute", inset: 0, padding: 22, display: "flex", flexDirection: "column" }}>
      {children}
    </motion.div>
  );
}

const LABEL = { fontSize: 12.5, fontWeight: 700, color: "#23201A" } as const;
const SUBTLE = { fontSize: 11, color: "#A89F8C" } as const;
const mathColor = { color: "#23201A", fontSize: 14 };

function GenerateStage() {
  const [focus, setFocus] = useState("");
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    const ts: number[] = [];
    for (let i = 1; i <= FOCUS_TEXT.length; i++) ts.push(window.setTimeout(() => setFocus(FOCUS_TEXT.slice(0, i)), 700 + i * 42));
    ts.push(window.setTimeout(() => setPressed(true), 700 + FOCUS_TEXT.length * 42 + 500));
    return () => ts.forEach(clearTimeout);
  }, []);
  return (
    <>
      <div style={{ ...LABEL, fontSize: 14, marginBottom: 16 }}>Generate more questions</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 13, flex: 1 }}>
        <Field label="Save to" hint="Pick the unit these belong to."><Chip selected>Systems &amp; Matrices</Chip></Field>
        <Field label="Source material" hint="Generate from your own uploads.">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 9, border: "1px solid #C8DCCF", background: "#EFF4F0", borderRadius: 9, padding: "8px 12px" }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M4 1.5h5L13 5.5V14a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 14V2a.5.5 0 0 1 .5-.5z" fill="#D9534F" opacity="0.85" /><path d="M9 1.5V5a.5.5 0 0 0 .5.5H13" stroke="#fff" strokeWidth="0.8" /></svg>
            <span style={{ fontSize: 13, color: "#23201A", fontWeight: 500 }}>Systems &amp; Matrices — Ch. 5.pdf</span>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="8" fill="#2F8F66" /><path d="M4.5 8.2l2.2 2.2 4.8-4.8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </Field>
        <Field label="How many?"><div style={{ display: "flex", gap: 6 }}>{[4, 6, 10].map((n) => <Chip key={n} selected={n === 4}>{n}</Chip>)}</div></Field>
        <Field label="Focus" hint="Tell the AI what to emphasize.">
          <div style={{ border: "1px solid #E4DFD2", borderRadius: 8, padding: "8px 12px", background: "#FBF9F3", minHeight: 36, fontSize: 13.5, color: "#23201A" }}>
            {focus}
            <motion.span style={{ display: "inline-block", width: 2, height: 14, background: "#0E5238", marginLeft: 1, verticalAlign: "middle" }} animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.9, repeat: Infinity }} />
          </div>
        </Field>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <motion.span animate={pressed ? { scale: [1, 0.94, 1] } : {}} transition={{ duration: 0.3 }} style={{ background: pressed ? "#0A3D2A" : "#0E5238", color: "#fff", fontWeight: 600, fontSize: 13.5, padding: "9px 20px", borderRadius: 999 }}>{pressed ? "Generating…" : "Generate"}</motion.span>
      </div>
    </>
  );
}

function ReviewStage() {
  const [n, setN] = useState(0);
  useEffect(() => { const ts = PROBLEMS.map((_, i) => window.setTimeout(() => setN(i + 1), 300 + i * 320)); return () => ts.forEach(clearTimeout); }, []);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ ...LABEL, letterSpacing: "0.04em" }}>PROBLEMS · {PROBLEMS.length}</span>
        <span style={SUBTLE}>generated from “Systems & Matrices.pdf”</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {PROBLEMS.slice(0, n).map((p, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, ease: EASE }} style={row}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ color: "#A89F8C", fontWeight: 600, fontSize: 13 }}>{i + 1}.</span>
              <span style={mathColor}><MathText text={p.q} /></span>
            </span>
            <Tag {...DIFF[p.d]}>{p.d}</Tag>
          </motion.div>
        ))}
      </div>
    </>
  );
}

function ProblemSolution({ data }: { data: ProblemData }) {
  return (
    <div style={{ ...row, alignItems: "flex-start", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <span style={mathColor}><MathText text={data.q} /></span>
        <Tag {...DIFF[data.d]}>{data.d}</Tag>
      </div>
      <div style={{ borderTop: "1px solid #EFEADD", paddingTop: 7, width: "100%" }}>
        <div style={{ ...SUBTLE, marginBottom: 4 }}>WORKED SOLUTION</div>
        {data.sol.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 7, marginBottom: 3, lineHeight: 1.5 }}>
            <span style={{ color: "#A89F8C", fontWeight: 700, fontSize: 11.5, flexShrink: 0 }}>{i + 1}.</span>
            <span style={{ fontSize: 12.5, color: "#6B6457" }}><strong style={{ color: "#23201A", fontWeight: 600 }}>{s.t}.</strong> <MathText text={s.b} /></span>
          </div>
        ))}
        <div style={{ color: "#0A3D2A", fontWeight: 600, fontSize: 13, marginTop: 4 }}>Answer:{" "}{data.ans.includes("$") ? <MathText text={data.ans} /> : data.ans}</div>
      </div>
    </div>
  );
}

function RefineStage() {
  const [step, setStep] = useState(0);
  useEffect(() => { const ts = [window.setTimeout(() => setStep(1), 2400), window.setTimeout(() => setStep(2), 4900)]; return () => ts.forEach(clearTimeout); }, []);
  return (
    <>
      <div style={{ ...SUBTLE, marginBottom: 8 }}>Problem 1 · workshop</div>
      <div style={{ marginBottom: 10 }}>
        <AnimatePresence mode="wait">
          {step < 2 ? (
            <motion.div key="before" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }}>
              <ProblemSolution data={REFINE_BEFORE} />
            </motion.div>
          ) : (
            <motion.div key="after" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, boxShadow: ["0 0 0 2px rgba(47,143,102,0.55)", "0 0 0 0px rgba(47,143,102,0)"] }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.34, ease: EASE, boxShadow: { duration: 1.2, delay: 0.15 } }} style={{ borderRadius: 10 }}>
              <ProblemSolution data={REFINE_AFTER} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <ChatRow who="teacher">make this one have no solution</ChatRow>
        {step >= 1 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
            <ChatRow who="ai">
              Made the matrix singular and the system inconsistent — rewrote the problem and the solution.
              {step < 2 ? (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <span style={{ background: "#0E5238", color: "#fff", fontWeight: 600, fontSize: 12.5, padding: "6px 14px", borderRadius: 999 }}>Accept</span>
                  <span style={{ border: "1px solid #E4DFD2", color: "#6B6457", fontWeight: 600, fontSize: 12.5, padding: "6px 14px", borderRadius: 999 }}>Discard</span>
                </div>
              ) : <div style={{ marginTop: 8, color: "#4A6B3A", fontWeight: 600, fontSize: 12.5 }}>✓ Accepted — question &amp; solution updated</div>}
            </ChatRow>
          </motion.div>
        )}
      </div>
    </>
  );
}

function PublishStage() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} style={{ display: "flex", flexDirection: "column", gap: 11, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Tag bg="#E8EAD9" fg="#0A3D2A">PUBLISHED</Tag>
        <span style={SUBTLE}>No due date · period 1 · 4 problems</span>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 22, color: "#23201A", lineHeight: 1.12 }}>Systems &amp; Matrices — solving 2×2 systems</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6B6457", fontSize: 12.5 }}>
        <span style={{ color: "#2F8F66" }}>●</span> Published — students can see this. Rubric &amp; instructions stay editable.
      </div>
      <div style={{ ...SUBTLE, marginTop: 4, letterSpacing: "0.04em" }}>PROBLEMS · 4</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[{ q: REFINE_AFTER.q, d: REFINE_AFTER.d }, PROBLEMS[1], PROBLEMS[2], PROBLEMS[3]].map((p, i) => (
          <div key={i} style={{ ...row, padding: "9px 14px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ color: "#A89F8C", fontWeight: 600, fontSize: 12.5 }}>{i + 1}.</span>
              <span style={{ color: "#23201A", fontSize: 13 }}><MathText text={p.q} /></span>
            </span>
            <Tag {...DIFF[p.d]}>{p.d}</Tag>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 10, borderTop: "1px solid #EFEADD" }}>
        <span style={{ color: "#0E5238", fontWeight: 600, fontSize: 13 }}>Preview as student →</span>
        <span style={{ border: "1px solid #E4DFD2", color: "#23201A", fontWeight: 600, fontSize: 12.5, padding: "6px 14px", borderRadius: 999 }}>Unpublish</span>
      </div>
    </motion.div>
  );
}

const row = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#FBF9F3", border: "1px solid #EFEADD", borderRadius: 10, padding: "11px 14px" } as const;
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (<div><div style={LABEL}>{label}</div>{hint ? <div style={{ ...SUBTLE, marginTop: 2, marginBottom: 6 }}>{hint}</div> : <div style={{ height: 6 }} />}{children}</div>);
}
function Chip({ children, selected }: { children: React.ReactNode; selected?: boolean }) {
  return <span style={{ display: "inline-flex", background: selected ? "#0E5238" : "#F2EEE3", color: selected ? "#fff" : "#6B6457", fontWeight: 600, fontSize: 12.5, padding: "6px 13px", borderRadius: 999, marginRight: 6 }}>{children}</span>;
}
function Tag({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap" }}>{children}</span>;
}
function ChatRow({ who, children }: { who: "teacher" | "ai"; children: React.ReactNode }) {
  const isAi = who === "ai";
  return (
    <div style={{ display: "flex", justifyContent: isAi ? "flex-start" : "flex-end" }}>
      <div style={{ maxWidth: "82%", background: isAi ? "#F2F5F0" : "#0E5238", color: isAi ? "#23201A" : "#fff", borderRadius: 12, padding: "9px 13px", fontSize: 13.5, lineHeight: 1.45 }}>
        {isAi && <span style={{ display: "block", fontSize: 10, letterSpacing: "0.08em", color: "#2F8F66", fontWeight: 700, marginBottom: 3, textTransform: "uppercase" }}>Veradic AI</span>}
        {children}
      </div>
    </div>
  );
}
