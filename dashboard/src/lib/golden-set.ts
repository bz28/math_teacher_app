// Golden Set data seam.
//
// The page renders entirely from the GoldenSet shape returned by
// loadGoldenSet(). Today that's a bundled, hand-verified snapshot of one run
// (src/data/golden-set.json). The seam is deliberate: when we wire the living
// benchmark, loadGoldenSet() becomes an API fetch returning the SAME shape and
// the page doesn't change. Keep the shape stable.

import raw from "../data/golden-set.json";

export type Verdict = {
  status: "verified" | "note";
  rederivation: string;
  note: string;
};

export type SolutionStep = { title: string; description: string };

export type Problem = {
  n: number;
  title: string;
  format: "mcq" | "frq" | string;
  difficulty: string;
  question: string;
  figureSvg: string | null;
  solutionSteps: SolutionStep[];
  finalAnswer: string;
  distractors: string[];
  verdict: Verdict;
};

export type Course = {
  key: string;
  name: string;
  unit: string;
  problems: Problem[];
};

export type Stat = { label: string; value: string; sub: string; tone: string };

export type FlowShot = { src: string; caption: string };

export type Finding = {
  title: string;
  severity: string;
  status: string;
  before: string;
  after: string;
  detail: string;
};

export type GoldenSet = {
  meta: {
    title: string;
    subtitle: string;
    capturedAt: string;
    model: string;
    teacher: string;
    intro: string;
    stats: Stat[];
  };
  courses: Course[];
  flow: FlowShot[];
  recording: string;
  findings: Finding[];
};

export function loadGoldenSet(): GoldenSet {
  return raw as unknown as GoldenSet;
}
