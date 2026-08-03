"use client";

/**
 * The integrity interview — the page's signature animated moment. A student's
 * correct submission is interrogated; she parrots the steps but can't explain
 * the reasoning, and the conversation resolves into the real teacher verdict:
 * graded 100% AND flagged for review (the actual product model — a disposition
 * + reasoning + notable moments, NOT an invented "integrity score").
 *
 * Plays once when scrolled into view; a replay control re-runs it. Honors
 * prefers-reduced-motion by jumping straight to the resolved verdict.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";

const SERIF = "var(--font-instrument-serif)";
const EASE = [0.22, 1, 0.36, 1] as const;

type Turn = { who: "veradic" | "maya"; text: string; think: number };
const TURNS: Turn[] = [
  { who: "veradic", text: "Nice — x = 5 is right. How'd you get the 5?", think: 800 },
  { who: "maya", text: "subtracted 7, then divided", think: 1100 },
  { who: "veradic", text: "Divided by what?", think: 700 },
  { who: "maya", text: "um… 3", think: 1300 },
  { who: "veradic", text: "Why 3, and not 22?", think: 800 },
  { who: "maya", text: "im not sure", think: 2200 },
];

type Phase = "chat" | "scoring" | "card";

export function IntegrityInterview() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("chat");
  const [run, setRun] = useState(0);

  const replay = useCallback(() => {
    setPhase("chat");
    setRun((n) => n + 1);
  }, []);

  // Reduced motion: render the resolved verdict directly (no setState-in-effect).
  const effectivePhase: Phase = reduce ? "card" : phase;

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        minHeight: 470,
        display: "flex",
        flexDirection: "column",
        // flex-start, not center: the heading beside (or above) this
        // is left-aligned, and a self-centring card gave the section
        // two different left edges at every stacked width.
        alignItems: "flex-start",
        justifyContent: "center",
      }}
    >
      {/* Skip straight to the payoff.
          The scripted exchange runs ~12.8s before the verdict card
          resolves, and it is the single most persuasive artifact on
          the site — a visitor who will not wait out the animation
          never sees the argument at all. The only existing control
          (Replay) appeared AFTER the payoff, which helps the people
          who already stayed. This is visible from the first turn and
          disappears once there is nothing left to skip. */}
      {!reduce && phase !== "card" && (
        <button
          type="button"
          onClick={() => setPhase("card")}
          style={{
            alignSelf: "flex-start",
            marginBottom: 10,
            background: "none",
            border: "none",
            padding: "4px 0",
            font: "inherit",
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--color-text-muted)",
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          Skip to the verdict
        </button>
      )}

      <div style={{ width: "100%", maxWidth: 600, display: "flex", justifyContent: "center" }}>
        <AnimatePresence mode="wait">
          {effectivePhase === "chat" ? (
            <motion.div key={`chat-${run}`} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4 }} style={{ width: "100%", maxWidth: 560 }}>
              {inView && !reduce ? <Interview run={run} onDone={() => setPhase("scoring")} /> : <ChatScaffold />}
            </motion.div>
          ) : effectivePhase === "scoring" ? (
            <motion.div
              key={`scoring-${run}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              onAnimationComplete={() => window.setTimeout(() => setPhase("card"), 1100)}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 80 }}
            >
              <motion.div style={{ width: 30, height: 30, borderRadius: "50%", border: "2.5px solid #1E4636", borderTopColor: "#7FC4A0" }} animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }} />
              <span style={{ color: "#8FB7A4", fontSize: 14 }}>Veradic is scoring this submission…</span>
            </motion.div>
          ) : (
            <motion.div key={`card-${run}`} initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: reduce ? 0 : 0.5, ease: EASE }} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <VerdictCard onReplay={reduce ? undefined : replay} />
              <ProcessEvidence reduce={reduce} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Static pre-roll: the submission header before the animation starts. */
function ChatScaffold() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SubmissionHeader />
      <Divider />
    </div>
  );
}

function Interview({ run, onDone }: { run: number; onDone: () => void }) {
  const [visible, setVisible] = useState(0);
  const [typing, setTyping] = useState<number | null>(null);
  const timers = useRef<number[]>([]);

  const play = useCallback(() => {
    // No state reset here — the component mounts fresh (and remounts on replay
    // via its key), so visible/typing already start at 0/null. Scheduling only
    // async timers keeps this out of the "setState synchronously in effect" rule.
    timers.current.forEach(clearTimeout);
    timers.current = [];
    let t = 900;
    const at = (fn: () => void) => timers.current.push(window.setTimeout(fn, t));
    TURNS.forEach((turn, i) => {
      t += 450;
      at(() => setTyping(i));
      t += turn.think;
      at(() => {
        setTyping(null);
        setVisible(i + 1);
      });
    });
    t += 900;
    at(onDone);
  }, [onDone]);

  useEffect(() => {
    play();
    return () => timers.current.forEach(clearTimeout);
  }, [play, run]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SubmissionHeader />
      <Divider />
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 196 }}>
        {TURNS.map((turn, i) => {
          const shown = i < visible;
          const isTyping = typing === i;
          if (!shown && !isTyping) return null;
          return (
            <div key={i} style={{ display: "flex", justifyContent: turn.who === "maya" ? "flex-end" : "flex-start" }}>
              <AnimatePresence mode="wait">
                {isTyping ? (
                  <motion.div key="dots" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                    <Bubble who={turn.who}><TypingDots /></Bubble>
                  </motion.div>
                ) : (
                  <motion.div key="text" initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4, ease: EASE }}>
                    <Bubble who={turn.who}>{turn.text}</Bubble>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubmissionHeader() {
  return (
    <div style={{ background: "#0E2C21", border: "1px solid #1E4636", borderRadius: 16, padding: "18px 20px", boxShadow: "0 24px 60px -28px rgba(0,0,0,0.7)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ color: "#E9E5D8", fontWeight: 600, fontSize: 15 }}>Maya R.</span>
        <span style={{ color: "#6E9684", fontSize: 12.5 }}>Algebra II · Period 3</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ color: "#AFC9BC", fontSize: 14 }}>Problem 4 · 3x + 7 = 22</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#7FC4A0", fontWeight: 600, fontSize: 14 }}>
          x = 5
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="8" fill="#1F7A4D" /><path d="M4.5 8.2l2.2 2.2 4.8-4.8" stroke="#EAF6EF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px" }}>
      <span style={{ flex: 1, height: 1, background: "#1C4334" }} />
      <span style={{ color: "#5F8C78", fontSize: 11.5, letterSpacing: "0.04em" }}>Veradic asks Maya to explain her work</span>
      <span style={{ flex: 1, height: 1, background: "#1C4334" }} />
    </div>
  );
}

function VerdictCard({ onReplay }: { onReplay?: () => void }) {
  const META = { fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" as const, color: "#A89F8C" };
  return (
    <div style={{ width: "100%", maxWidth: 600, margin: "0 auto", background: "#FBF9F3", borderRadius: 18, overflow: "hidden", boxShadow: "0 28px 70px -24px rgba(0,0,0,0.55)", border: "1px solid #ECE7DA" }}>
      <div style={{ borderBottom: "1px solid #EFEADD", padding: "16px 24px" }}>
        <div style={META}>Submission review · Algebra II · Period 3</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4, gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#23201A" }}>Maya R.<span style={{ fontWeight: 400, color: "#6B6457", fontSize: 14 }}> · Problem 4 — Radical equations</span></div>
          <div style={{ fontSize: 12, color: "#A89F8C" }}>submitted 2 hours ago</div>
        </div>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid #EFEADD" }}>
        <div style={{ flex: 1, padding: "18px 24px", borderRight: "1px solid #EFEADD" }}>
          <div style={META}>Homework grade</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 34, fontWeight: 700, color: "#23201A", lineHeight: 1 }}>100<span style={{ fontSize: 20, color: "#A89F8C" }}>%</span></span>
            <span style={{ color: "#4A6B3A", fontWeight: 600, fontSize: 13 }}>✓ answer correct</span>
          </div>
        </div>
        <div style={{ flex: 1, padding: "18px 24px" }}>
          <div style={META}>Integrity</div>
          <div style={{ marginTop: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#F0D7D1", color: "#8A2317", fontWeight: 700, fontSize: 12, letterSpacing: "0.04em", padding: "5px 11px", borderRadius: 999 }}>⚑ Flagged for review</span>
          </div>
        </div>
      </div>
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div style={META}>Why</div>
          <p style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 21, lineHeight: 1.3, color: "#23201A", margin: "8px 0 0" }}>&ldquo;Right answer, but she couldn&rsquo;t explain her own method.&rdquo;</p>
        </div>
        <div>
          <div style={META}>Key moments from the conversation</div>
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {["Solved 3x + 7 = 22 → x = 5 correctly.", "Couldn’t say why she divided by 3, not 22.", "Went silent when asked to justify her steps."].map((b) => (
              <li key={b} style={{ display: "flex", gap: 11, fontSize: 14.5, lineHeight: 1.5, color: "#6B6457" }}>
                <span style={{ marginTop: 9, width: 12, height: 2, borderRadius: 2, background: "#2F8F66", flexShrink: 0 }} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #EFEADD", background: "#F4F1E9", padding: "14px 24px" }}>
        <span style={{ color: "#0E5238", fontWeight: 600, fontSize: 14 }}>See full conversation →</span>
        {onReplay ? (
          <button type="button" onClick={onReplay} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #D8D0BF", background: "#FBF9F3", color: "#23201A", fontWeight: 600, fontSize: 13, padding: "7px 15px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit" }}>↻ Replay</button>
        ) : (
          <span style={{ border: "1px solid #D8D0BF", background: "#FBF9F3", color: "#23201A", fontWeight: 600, fontSize: 13, padding: "7px 15px", borderRadius: 999 }}>Dismiss flag</span>
        )}
      </div>
    </div>
  );
}

/**
 * Corroborating process signals — the teacher's-eye view that resolves *beside*
 * the conversation verdict. These are the real, shipped `activity_summary`
 * telemetry (tab-outs + pastes) the teacher reviews alongside a flag. Honest
 * framing is load-bearing here: this is CONTEXT the teacher sees, it does NOT
 * drive the AI's pass/flag decision (that comes purely from the conversation).
 * Numbers count up on reveal; reduced-motion jumps to the resolved values.
 */
function ProcessEvidence({ reduce }: { reduce: boolean | null }) {
  const META = { fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" as const, color: "#8FB7A4" };
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE, delay: reduce ? 0 : 0.5 }}
      style={{
        width: "100%",
        maxWidth: 600,
        margin: "0 auto",
        background: "linear-gradient(180deg, #0E2C21 0%, #0B2419 100%)",
        border: "1px solid #1E4636",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "0 26px 64px -30px rgba(0,0,0,0.7)",
      }}
    >
      <div style={{ padding: "16px 22px 14px", borderBottom: "1px solid #173A2C" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <EyeGlyph />
          <span style={META}>Corroborating signals her teacher sees</span>
        </div>
        <p style={{ margin: "9px 0 0", fontFamily: SERIF, fontStyle: "italic", fontSize: 19, lineHeight: 1.3, color: "#E9E5D8" }}>
          And while she worked&hellip;
        </p>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #173A2C" }}>
        <SignalTile
          icon={<TabOutGlyph />}
          value={<CountUp to={4} reduce={reduce} suffix="×" />}
          label="tabbed away"
          detail="2m 10s across the session"
          border
        />
        <SignalTile
          icon={<PasteGlyph />}
          value={<CountUp to={180} reduce={reduce} />}
          label="characters pasted"
          detail="one paste, all at once"
        />
      </div>

      <p style={{ margin: 0, padding: "13px 22px", fontSize: 12, lineHeight: 1.5, color: "#7FA593" }}>
        Context the teacher reviews alongside the conversation. It doesn&rsquo;t
        drive the flag &mdash; that came from Maya not being able to explain her
        own method.
      </p>
    </motion.div>
  );
}

function SignalTile({ icon, value, label, detail, border }: { icon: React.ReactNode; value: React.ReactNode; label: string; detail: string; border?: boolean }) {
  return (
    <div style={{ flex: 1, padding: "18px 22px", borderRight: border ? "1px solid #173A2C" : undefined, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, background: "#143427", border: "1px solid #21503C", color: "#7FC4A0", flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 30, fontWeight: 700, color: "#F4F1E8", lineHeight: 1, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      </div>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: "#CFE3D8", marginTop: 6 }}>{label}</span>
      <span style={{ fontSize: 12, color: "#6E9684" }}>{detail}</span>
    </div>
  );
}

/** Eases a count from 0 → `to` once on mount; honors reduced motion. */
function CountUp({ to, reduce, suffix = "" }: { to: number; reduce: boolean | null; suffix?: string }) {
  // Initial state already resolves to `to` under reduced motion, so the effect
  // only needs to drive the count-up animation — no synchronous setState.
  const [n, setN] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const delay = 720;
    const dur = 900;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start - delay) / dur));
      const eased = 1 - Math.pow(1 - t, 3);
      setN(Math.round(eased * to));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, reduce]);
  return (
    <>
      {n}
      {suffix}
    </>
  );
}

function EyeGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z" stroke="#7FC4A0" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1.9" fill="#7FC4A0" />
    </svg>
  );
}

function TabOutGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
      <rect x="1.5" y="3.5" width="11" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 6.3h11" stroke="currentColor" strokeWidth="1.3" />
      <path d="M11 11.5l5-5m0 0h-3.4m3.4 0v3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PasteGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <rect x="3.5" y="2.5" width="11" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.5" y="1.2" width="5" height="3" rx="1" fill="currentColor" />
      <path d="M6.3 8.2h5.4M6.3 11h3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function Bubble({ who, children }: { who: "veradic" | "maya"; children: React.ReactNode }) {
  const isMaya = who === "maya";
  return (
    <div style={{ maxWidth: "78%", padding: "10px 14px", borderRadius: 14, fontSize: 14.5, lineHeight: 1.45, background: isMaya ? "#1B3A2C" : "#102A20", border: `1px solid ${isMaya ? "#2A5743" : "#1C4030"}`, color: isMaya ? "#E9E5D8" : "#A9C6B8" }}>
      {!isMaya && <span style={{ display: "block", fontSize: 10.5, letterSpacing: "0.08em", color: "#5FAE89", marginBottom: 3, textTransform: "uppercase" }}>Veradic</span>}
      {children}
    </div>
  );
}

function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, padding: "2px 2px" }}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: "#6E9684", display: "inline-block" }} animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }} />
      ))}
    </span>
  );
}
