// Teaching-day golden-set data seam.
//
// Sibling to lib/grading-set.ts, lib/integrity-set.ts and lib/generation-set.ts.
// The TeacherDaySet page renders entirely from the shape returned by
// loadTeacherDaySet(). Today that's a bundled, hand-authored snapshot
// (src/data/teacher-day.json) over a live-captured walkthrough of the real
// teaching-day surfaces — the cross-course "needs you today" triage queue,
// Student Insights, and the one-click reteach → generated practice flow — with
// one illustrative seeded class (Algebra I · Period 3).
//
// The seam is deliberate: if we ever wire a live teaching-day feed,
// loadTeacherDaySet() becomes an API fetch returning the SAME shape and the
// page doesn't change. Keep it stable.

import raw from "../data/teacher-day.json";

// Structurally identical to grading-set's Hero / FlowShot so the shared demo
// components (HeroBlock, FlowStep) accept this data unchanged.
export type Hero = {
  eyebrow: string;
  headline: string;
  subhead: string;
  triplet: string[];
  cue: string;
};

export type FlowShot = { src: string; title: string; caption: string };

// One framed beat inside the ★ moment's insight→action loop.
export type LoopShot = { src: string; step: string; label: string; sub: string };

// The teaching-day moment is bespoke: instead of a single screenshot it renders
// the insight→action loop as three connected beats — the struggle signal (03),
// the pre-titled reteach (04), and the ten generated problems (05).
export type Moment = {
  step: string;
  eyebrow: string;
  title: string;
  body: string;
  sell: string;
  note: string;
  signal: LoopShot;
  bridge: LoopShot;
  action: LoopShot;
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

export type TeacherDaySet = {
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
  payoff: Payoff;
  byNumbers: ByNumber[];
};

export function loadTeacherDaySet(): TeacherDaySet {
  return raw as unknown as TeacherDaySet;
}
