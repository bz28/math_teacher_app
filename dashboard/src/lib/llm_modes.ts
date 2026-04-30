// Single source of truth for the LLMCall.function values we know
// about — mirrors api/core/llm_client.py LLMMode. When a new mode
// lands on the backend, add it here so the bucket map, colors, and
// any future per-function drill-downs all pick it up at once
// instead of three pages drifting independently.

export const LLM_MODES = {
  DECOMPOSE: "decompose",
  DECOMPOSE_DIAGNOSIS: "decompose_diagnosis",
  STEP_CHAT: "step_chat",
  PRACTICE_GENERATE: "practice_generate",
  PRACTICE_EVAL: "practice_eval",
  IMAGE_EXTRACT: "image_extract",
  DIAGNOSE_WORK: "diagnose_work",
  JUDGE: "judge",
  SUGGEST_UNITS: "suggest_units",
  GENERATE_QUESTIONS: "generate_questions",
  REGENERATE_BANK_ITEM: "regenerate_bank_item",
  BANK_CHAT: "bank_chat",
  INTEGRITY_EXTRACT: "integrity_extract",
  INTEGRITY_AGENT: "integrity_agent",
  INTEGRITY_ANSWER_EQUIVALENCE: "integrity_answer_equivalence",
  BANK_EXTRACT: "bank_extract",
  AI_GRADING: "ai_grading",
} as const;

export type LLMMode = (typeof LLM_MODES)[keyof typeof LLM_MODES];

// Pipeline stages a per-submission flight recorder rolls calls into.
// Vision / Integrity / Grading are the three real stages a graded HW
// submission walks through; everything else (chat, bank, practice
// generation) lands in "Other" and is rare on the per-submission
// view since most of those modes don't carry a submission_id.
export const PIPELINE_BUCKETS: { label: string; functions: string[] }[] = [
  {
    label: "Vision",
    functions: [
      LLM_MODES.IMAGE_EXTRACT,
      LLM_MODES.INTEGRITY_EXTRACT,
      LLM_MODES.BANK_EXTRACT,
    ],
  },
  {
    label: "Integrity",
    functions: [
      LLM_MODES.INTEGRITY_AGENT,
      LLM_MODES.INTEGRITY_ANSWER_EQUIVALENCE,
    ],
  },
  { label: "Grading", functions: [LLM_MODES.AI_GRADING] },
];

export function bucketFor(fnName: string): string {
  for (const b of PIPELINE_BUCKETS) {
    if (b.functions.includes(fnName)) return b.label;
  }
  return "Other";
}

// Per-function color palette. Hues picked so deutan/protan-confusable
// pairs don't sit on adjacent stack-bar segments — the integrity pair
// uses indigo + magenta rather than the more obvious indigo + violet.
export const FUNCTION_COLORS: Record<string, string> = {
  [LLM_MODES.IMAGE_EXTRACT]: "#0ea5e9",
  [LLM_MODES.INTEGRITY_EXTRACT]: "#22d3ee",
  [LLM_MODES.BANK_EXTRACT]: "#06b6d4",
  [LLM_MODES.AI_GRADING]: "#10b981",
  [LLM_MODES.INTEGRITY_AGENT]: "#6366f1",
  [LLM_MODES.INTEGRITY_ANSWER_EQUIVALENCE]: "#ec4899",
};

export function colorForFunction(fnName: string): string {
  return FUNCTION_COLORS[fnName] ?? "#94a3b8";
}
