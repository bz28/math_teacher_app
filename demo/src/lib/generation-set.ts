// Problem-generation golden-set data seam.
//
// Sibling to lib/grading-set.ts and lib/integrity-set.ts. The GenerationSet page
// renders entirely from the shape returned by loadGenerationSet(). The narrative
// (hero, flow, moment copy, payoff) is a bundled, hand-authored snapshot
// (src/data/generation.json) over a live-captured walkthrough of the real
// generate → review → refine → approve product.
//
// The ★ moment's verified problem is NOT re-authored here — it's pulled verbatim
// from the hand-checked Golden Set (src/data/golden-set.json) by course + number,
// so the centerpiece is provably the same generated problem and independent
// re-derivation shown on /golden-set. Honesty by construction: the re-derivation
// text traces to real golden-set data, not invented copy.
//
// The seam is deliberate: if we ever wire a live generation benchmark,
// loadGenerationSet() becomes an API fetch returning the SAME shape and the page
// doesn't change. Keep it stable.

import raw from "../data/generation.json";
import golden from "../data/golden-set.json";
import type { Problem } from "./golden-set";
import type { HeroPeek } from "./integrity-set";

// Structurally identical to grading-set's Hero / FlowShot so the shared demo
// components (HeroBlock, FlowStep) accept this data unchanged.
export type Hero = {
  eyebrow: string;
  headline: string;
  subhead: string;
  triplet: string[];
  cue: string;
  peek?: HeroPeek;
};

export type FlowShot = { src: string; title: string; caption: string };

// The generation moment is bespoke: instead of a single screenshot, it pulls a
// real verified problem out of the Golden Set. `courseKey`/`problemN` select it;
// the rest is the surrounding copy.
export type Moment = {
  step: string;
  eyebrow: string;
  title: string;
  body: string;
  sell: string;
  note: string;
  verifiedLabel: string;
  courseKey: string;
  problemN: number;
};

export type PayoffPoint = { title: string; body: string };

export type Payoff = {
  eyebrow: string;
  title: string;
  lead: string;
  points: PayoffPoint[];
  closing: string;
};

export type ByNumber = { value: string; label: string; sub: string };

export type GenerationSet = {
  meta: {
    title: string;
    subtitle: string;
    framing: string;
    capturedAt: string;
    model: string;
    source: string;
  };
  hero: Hero;
  flowSetup: FlowShot[];
  moment: Moment;
  flowResolution: FlowShot[];
  payoff: Payoff;
  byNumbers: ByNumber[];
  // Resolved from the Golden Set at load time — the verified centerpiece.
  problem: Problem;
  courseName: string;
};

export function loadGenerationSet(): GenerationSet {
  const r = raw as unknown as Omit<GenerationSet, "problem" | "courseName">;
  const course = golden.courses.find((c) => c.key === r.moment.courseKey);
  const problem = course?.problems.find((p) => p.n === r.moment.problemN);
  if (!course || !problem) {
    throw new Error(
      `generation-set: moment problem ${r.moment.courseKey}#${r.moment.problemN} not found in golden-set`,
    );
  }
  return { ...r, problem: problem as unknown as Problem, courseName: course.name };
}
