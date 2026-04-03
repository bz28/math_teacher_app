"use client";

import { motion } from "framer-motion";

/* ── Browser frame wrapper ── */
export function BrowserFrame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[--radius-xl] border border-border bg-surface shadow-lg ${className}`}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-border-light bg-card px-4 py-2.5">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#FFBD2E]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        </div>
        <div className="mx-auto flex h-6 w-48 items-center justify-center rounded-[--radius-sm] bg-input-bg px-3 text-[10px] text-text-muted">
          veradicai.com
        </div>
        <div className="w-[52px]" />
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </div>
  );
}

/* ── Hero Mockup — Simple algebra, in-progress ── */
export function LearnSessionMockup() {
  return (
    <div className="space-y-3.5">
      {/* Problem */}
      <div>
        <p className="text-[10px] font-medium text-text-muted">Problem</p>
        <p className="mt-0.5 text-sm font-semibold leading-snug text-text-primary">
          Solve for x: 2x² + 5x − 3 = 0
        </p>
      </div>

      {/* Progress bar */}
      <div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-light">
          <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-primary to-primary-light" />
        </div>
        <p className="mt-1 text-[10px] text-text-muted">Step 2 of 5</p>
      </div>

      {/* Completed step 1 — expanded like the real product */}
      <div className="rounded-[--radius-md] border border-border-light bg-card/50 p-3">
        <div className="flex items-start gap-3">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-success">
            <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-success">Step 1 — Understand the Problem</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-primary">
              We have a <span className="font-bold">quadratic equation</span> 2x² + 5x − 3 = 0
              and need to find the values of x that make it true. Since the highest power is x², we
              expect to find two solutions. The most elegant approach is the <span className="font-bold">quadratic formula</span>{" "}since
              this doesn&apos;t factor easily.
            </p>
          </div>
        </div>
      </div>

      {/* Active step 2 */}
      <StepCard
        num={2}
        title="Identify Coefficients"
        active
      >
        <p className="mt-1 text-[11px] leading-relaxed text-text-primary">
          In the standard form ax² + bx + c = 0, we identify:
        </p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-text-primary">
          <li>- a = 2 (coefficient of x²)</li>
          <li>- b = 5 (coefficient of x)</li>
          <li>- c = −3 (constant term)</li>
        </ul>
        <p className="mt-1.5 text-[11px] text-text-primary">
          These values will be plugged into the quadratic formula.
        </p>
      </StepCard>

      {/* Input area — matches real product */}
      <div className="space-y-1.5">
        <p className="text-[10px] text-text-muted">Have a question about this step?</p>
        <div className="flex gap-2">
          <div className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-3 py-1.5 text-[10px] text-text-muted">
            Ask a question...
          </div>
          <div className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-[10px] font-bold text-white">
            I Understand
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Features Row 1 — Physics with energy conservation ── */
export function StepTimelineMockup() {
  return (
    <div className="space-y-3">
      {/* Problem */}
      <div className="rounded-[--radius-md] border border-border-light bg-card/50 p-3">
        <p className="text-[10px] text-text-muted">Problem</p>
        <p className="mt-0.5 text-xs font-semibold text-text-primary">
          A 2 kg ball is dropped from rest at a height of 10 m. Find its velocity just before hitting the ground. (g = 9.8 m/s²)
        </p>
      </div>

      {/* Progress */}
      <div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-light">
          <div className="h-full w-1/4 rounded-full bg-gradient-to-r from-primary to-primary-light" />
        </div>
        <p className="mt-1 text-[10px] text-text-muted">Step 2 of 4</p>
      </div>

      {/* Completed step 1 — expanded with real explanation */}
      <div className="rounded-[--radius-md] border border-border-light bg-card/50 p-3">
        <div className="flex items-start gap-3">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-success">
            <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-success">Step 1 — Understanding the Problem</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-primary">
              We have a ball falling freely under gravity from rest. This is a <span className="font-bold">free fall motion</span> problem
              where we need to find the final velocity just before impact.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-primary">
              The key insight is that we know the initial velocity (v₀ = 0), the displacement (h = 10 m),
              and the acceleration (g = 9.8 m/s²).
            </p>
          </div>
        </div>
      </div>

      {/* Active step 2 — with equation and list */}
      <StepCard
        num={2}
        title="Choose the Right Equation"
        active
      >
        <p className="mt-1 text-[11px] leading-relaxed text-text-primary">
          For free fall problems where we know initial velocity, displacement, and acceleration,
          the most direct approach is the <span className="font-bold">kinematic equation</span>:
        </p>
        <p className="my-1.5 text-center text-xs font-medium italic text-text-primary">
          v² = v₀² + 2gh
        </p>
        <p className="text-[11px] text-text-primary">This equation is perfect because:</p>
        <ul className="mt-0.5 space-y-0.5 text-[11px] text-text-primary">
          <li>- v₀ = 0 (starts from rest)</li>
          <li>- h = 10 m (displacement downward)</li>
          <li>- g = 9.8 m/s² (acceleration due to gravity)</li>
          <li>- v = what we want to find</li>
        </ul>
      </StepCard>
    </div>
  );
}

/* ── Features Row 2 — Chemistry chat ── */
export function ChatMockup() {
  return (
    <div className="space-y-3">
      {/* Active step context */}
      <StepCard
        num={2}
        title="Balance the Equation"
        description="Balance the chemical equation: Fe + O₂ → Fe₂O₃. Start with the most complex molecule and work outward."
        active
      />

      {/* User question — simple term question */}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[--radius-md] bg-primary-bg px-3 py-2 text-xs text-primary">
          What does &quot;balancing&quot; actually mean?
        </div>
      </div>

      {/* Tutor response */}
      <div className="rounded-[--radius-md] border border-primary/15 bg-card p-3">
        <div className="flex items-start gap-2">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
              <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-primary">Tutor</p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-primary">
              Balancing means making sure the <span className="font-semibold">same number of each type of atom</span> appears
              on both sides of the arrow. Atoms can&apos;t be created or destroyed in a reaction — so if you start
              with 2 iron atoms, you must end with 2.
            </p>
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <div className="flex-1 rounded-[--radius-md] border border-border bg-input-bg px-3 py-1.5 text-[10px] text-text-muted">
          Ask a question...
        </div>
        <div className="rounded-[--radius-md] bg-border px-3 py-1.5 text-[10px] font-semibold text-text-secondary">
          I Understand
        </div>
      </div>
    </div>
  );
}

/* ── Features Row 3 — Practice with diagram ── */
export function PracticeMockup() {
  return (
    <div className="space-y-3">
      {/* Progress */}
      <p className="text-[10px] font-semibold text-text-muted">Question 4 of 5</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-light">
        <div className="h-full w-3/5 rounded-full bg-gradient-to-r from-primary to-primary-light" />
      </div>

      {/* Question with triangle diagram */}
      <div className="rounded-[--radius-md] border border-border-light bg-surface p-3">
        <p className="text-xs font-medium text-text-primary">
          A right triangle has legs of length 5 and 12. What is the length of the hypotenuse?
        </p>
        <div className="mt-2 flex justify-center">
          <svg width="120" height="80" viewBox="0 0 120 80" className="text-text-muted">
            <line x1="10" y1="68" x2="105" y2="68" stroke="currentColor" strokeWidth="1.5" />
            <line x1="105" y1="68" x2="105" y2="12" stroke="currentColor" strokeWidth="1.5" />
            <line x1="10" y1="68" x2="105" y2="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 2" />
            <text x="57" y="64" textAnchor="middle" className="fill-text-secondary text-[10px]">12</text>
            <text x="112" y="42" textAnchor="start" className="fill-text-secondary text-[10px]">5</text>
            <text x="48" y="34" textAnchor="middle" className="fill-primary text-[10px] font-bold">?</text>
            <polyline points="97,68 97,60 105,60" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </div>
      </div>

      {/* Choices */}
      <div className="grid grid-cols-2 gap-2">
        <ChoiceButton label="A" text="10" />
        <ChoiceButton label="B" text="13" correct />
        <ChoiceButton label="C" text="15" />
        <ChoiceButton label="D" text="17" />
      </div>
    </div>
  );
}

/* ── Shared components ── */

function StepCard({
  num,
  title,
  description,
  active,
  children,
}: {
  num: number;
  title: string;
  description?: string;
  active?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-[--radius-md] p-3 ${
        active
          ? "border border-primary/20 bg-primary-bg/20 shadow-sm"
          : "border border-border-light bg-card/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-light text-[10px] font-bold text-white">
          {num}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-primary">{title}</p>
          {description && (
            <p className="mt-1 text-[11px] leading-relaxed text-text-primary">
              {description}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}


function ChoiceButton({
  label,
  text,
  correct,
}: {
  label: string;
  text: string;
  correct?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-[--radius-md] border p-2.5 ${
        correct
          ? "border-success bg-success-light"
          : "border-border-light bg-surface"
      }`}
    >
      <span
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          correct ? "bg-success text-white" : "bg-border-light text-text-muted"
        }`}
      >
        {label}
      </span>
      <span className={`text-xs font-medium ${correct ? "text-success" : "text-text-primary"}`}>
        {text}
      </span>
      {correct && (
        <svg className="ml-auto h-3.5 w-3.5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );
}

export function FloatingMockup({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}
