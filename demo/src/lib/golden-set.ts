// Golden Set data seam.
//
// The page renders entirely from the GoldenSet shape returned by
// loadGoldenSet(). Today that's a bundled, hand-verified snapshot (curated to
// figure-faithful, correct problems — see src/data/golden-set.json). The seam
// is deliberate: when we wire a live benchmark, loadGoldenSet() becomes an API
// fetch returning the SAME shape and the page doesn't change. Keep it stable.
//
// SECURITY NOTE for that future swap: the page injects each problem's
// `figureSvg` via dangerouslySetInnerHTML. Today the SVG is our own
// backend-rendered output bundled at build time, so it's trusted. If this data
// ever comes from a live/less-trusted source, sanitize the SVG first
// (e.g. DOMPurify with the SVG profile) — raw SVG can carry <script>/on* handlers.

import raw from "../data/golden-set.json";

export type Verdict = { rederivation: string };

export type SolutionStep = { title: string; description: string };

export type Problem = {
  n: number;
  title: string;
  format: "mcq" | "frq";
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

export type Stat = { label: string; value: string; sub: string };

export type FlowShot = { src: string; caption: string };

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
};

export function loadGoldenSet(): GoldenSet {
  return raw as unknown as GoldenSet;
}
