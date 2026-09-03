// Customize-section option data and the closed-header summary.
//
// Split out of generation-params-customize.tsx so the summary logic is
// importable by a plain `node --test` file — the component itself is
// JSX and this repo has no React test renderer. Same split as
// homework-buckets.ts / homework-buckets.test.ts.
import type { GenerationParams } from "@/lib/api";

// Labels + tooltip copy for the Customize dropdowns. Tied to the
// GenerationParams shape; defaults at index 0 of each list translate
// to "no prompt instruction" on the backend, so the 1-click flow is
// byte-identical when the teacher doesn't customize.
export const PARAM_OPTIONS: {
  key: keyof GenerationParams;
  label: string;
  help: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "problem_type",
    label: "Problem type",
    help: "What shape the problems take.",
    options: [
      { value: "mixed", label: "Mixed" },
      { value: "word", label: "Word problems only" },
      { value: "computation", label: "Computation only" },
      { value: "multi_step", label: "Multi-step" },
      { value: "proof", label: "Proofs" },
    ],
  },
  {
    key: "answer_form",
    label: "Answer form",
    help:
      "How final answers come out. Whole numbers is the odd one — it " +
      "shapes the problem so answers land clean, rather than reformatting " +
      "an answer that already exists, so topics that can't support it " +
      "(irrational roots, most trig) will ignore it rather than round.",
    options: [
      { value: "auto", label: "Auto" },
      { value: "integer", label: "Whole numbers" },
      { value: "radical", label: "Radical form" },
      { value: "rational_exponent", label: "Rational exponent" },
      { value: "exact", label: "Exact (no decimals)" },
      { value: "decimal_2", label: "Decimal · 2 sig figs" },
      { value: "decimal_3", label: "Decimal · 3 sig figs" },
    ],
  },
  {
    key: "difficulty",
    label: "Difficulty",
    help:
      "Relative to this course's student level (not absolute math). " +
      "Ramp orders easy → hard across the set.",
    options: [
      { value: "mixed", label: "Mixed" },
      { value: "easy", label: "All easy" },
      { value: "medium", label: "All medium" },
      { value: "hard", label: "All hard" },
      { value: "ramp", label: "Easy → hard ramp" },
    ],
  },
  {
    key: "calculator",
    label: "Calculator",
    help:
      "No-calc keeps numerics clean (standard angles, integer evals). " +
      "Calculator-allowed lets the AI use messy decimals freely.",
    options: [
      { value: "either", label: "Either" },
      { value: "no_calc", label: "No calculator" },
      { value: "calc_allowed", label: "Calculator allowed" },
    ],
  },
  {
    key: "format",
    label: "Format",
    help:
      "MCQ poses the problem with 4 choices the student picks between. " +
      "FRQ is open-ended.",
    options: [
      { value: "frq", label: "Free response" },
      { value: "mcq", label: "Multiple choice" },
    ],
  },
];

// How many applied settings to name before collapsing the rest into
// "+N more". Two keeps the closed header to one line at the narrowest
// width we support; the badge still carries the true count.
const SUMMARY_LIMIT = 2;

/** Human summary of what is currently applied, e.g. "All hard · Multiple
 *  choice +1 more". Reads its words straight out of PARAM_OPTIONS so the
 *  closed header can never disagree with the dropdowns it summarizes.
 *
 *  `defaults` is passed in rather than imported so this module holds no
 *  runtime import of "@/lib/api" — the "@/" alias is unresolvable under
 *  plain `node --test`, which is how this repo runs its frontend unit
 *  tests. Keeping the function pure is what makes it testable at all. */
export function activeSummary(
  params: GenerationParams,
  defaults: GenerationParams,
): string {
  const applied = PARAM_OPTIONS.filter(
    ({ key }) => params[key] !== defaults[key],
  ).map(
    ({ key, options }) =>
      options.find((o) => o.value === params[key])?.label ?? String(params[key]),
  );
  const shown = applied.slice(0, SUMMARY_LIMIT).join(" · ");
  const rest = applied.length - SUMMARY_LIMIT;
  return rest > 0 ? `${shown} +${rest} more` : shown;
}
