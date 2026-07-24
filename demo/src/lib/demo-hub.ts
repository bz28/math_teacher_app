// Demo-hub data seam.
//
// Sibling to lib/integrity-set.ts and lib/grading-set.ts. The DemoHub page is the
// single front door to the demo — the overarching platform pitch that links into
// the deep-dive stories. It renders entirely from the shape returned by
// loadDemoHub(). Today that's a bundled, hand-authored snapshot
// (src/data/demo-hub.json): platform-level copy plus representative shots reused
// from the integrity/grading stories' public assets. The seam is deliberate and
// mirrors its siblings: if we ever wire this to a CMS or API, loadDemoHub()
// becomes a fetch returning the SAME shape and the page doesn't change.

import raw from "../data/demo-hub.json";
import type { HeroPeek } from "./integrity-set";

// Structurally identical to integrity-set's Hero so the shared HeroBlock accepts
// this data unchanged.
export type Hero = {
  eyebrow: string;
  headline: string;
  subhead: string;
  /** Optional three-beat of what it does. Omitted on the front-door hero. */
  triplet?: string[];
  cue: string;
  peek?: HeroPeek;
};

export type FlowBeat = {
  step: string;
  title: string;
  line: string;
  /** The explicit ease through-line — how little the teacher has to do at this beat. */
  ease: string;
  shot: string;
  /** Present only on the analytics beat — its prominence label (e.g. "What you can see"). */
  feature?: string;
};

export type Flow = {
  eyebrow: string;
  title: string;
  sub: string;
  beats: FlowBeat[];
  /** One honest ease/capability line that caps the spine. */
  cap: string;
};

export type UseCaseCard = {
  key: string;
  tag: string;
  title: string;
  benefit: string;
  shot: string;
  cta: string;
};

export type UseCases = {
  eyebrow: string;
  title: string;
  sub: string;
  cards: UseCaseCard[];
};

export type Roi = {
  eyebrow: string;
  title: string;
  sub: string;
};

export type DemoHub = {
  meta: {
    framing: string;
    source: string;
    model: string;
    capturedAt: string;
  };
  hero: Hero;
  flow: Flow;
  useCases: UseCases;
  roi: Roi;
};

export function loadDemoHub(): DemoHub {
  return raw as unknown as DemoHub;
}
