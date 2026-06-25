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
        alignItems: "center",
        justifyContent: "center",
      }}
    >
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
            <motion.div key={`card-${run}`} initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: reduce ? 0 : 0.5, ease: EASE }} style={{ width: "100%" }}>
              <VerdictCard onReplay={reduce ? undefined : replay} />
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
