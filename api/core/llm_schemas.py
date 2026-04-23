"""Anthropic tool-use schemas for structured LLM responses.

Each schema is a tool definition dict passed to client.messages.create(tools=[...]).
The API returns a tool_use content block with properly serialized JSON — no
markdown fencing or manual JSON parsing needed.
"""

from typing import Any

ToolSchema = dict[str, Any]

# ---------------------------------------------------------------------------
# Practice
# ---------------------------------------------------------------------------

DISTRACTOR_SCHEMA: ToolSchema = {
    "name": "return_distractors",
    "description": "Return 3 plausible but wrong answers for a multiple-choice question.",
    "input_schema": {
        "type": "object",
        "properties": {
            "distractors": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Exactly 3 wrong answers that target common student mistakes.",
            },
        },
        "required": ["distractors"],
        "additionalProperties": False,
    },
}

PRACTICE_GENERATE_SCHEMA: ToolSchema = {
    "name": "return_problems",
    "description": "Return a list of generated practice problems.",
    "input_schema": {
        "type": "object",
        "properties": {
            "problems": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of problem text strings.",
            },
        },
        "required": ["problems"],
        "additionalProperties": False,
    },
}

# ---------------------------------------------------------------------------
# Tutor
# ---------------------------------------------------------------------------

FEEDBACK_SCHEMA: ToolSchema = {
    "name": "return_feedback",
    "description": "Return tutoring feedback to the student.",
    "input_schema": {
        "type": "object",
        "properties": {
            "feedback": {
                "type": "string",
                "description": "The helpful response to the student's question.",
            },
        },
        "required": ["feedback"],
        "additionalProperties": False,
    },
}

ANSWER_EQUIVALENCE_SCHEMA: ToolSchema = {
    "name": "return_equivalence",
    "description": "Return whether the student's answer is equivalent to the correct answer.",
    "input_schema": {
        "type": "object",
        "properties": {
            "is_correct": {
                "type": "boolean",
                "description": "True if the student's answer is equivalent to the correct answer.",
            },
        },
        "required": ["is_correct"],
        "additionalProperties": False,
    },
}

# ---------------------------------------------------------------------------
# Judge
# ---------------------------------------------------------------------------

JUDGE_SCHEMA: ToolSchema = {
    "name": "return_quality_scores",
    "description": "Return quality scores for a step-by-step solution.",
    "input_schema": {
        "type": "object",
        "properties": {
            "correctness": {"type": "integer", "description": "Math correctness score 1-5."},
            "optimality": {"type": "integer", "description": "Approach optimality score 1-5."},
            "clarity": {"type": "integer", "description": "Step clarity score 1-5."},
            "flow": {"type": "integer", "description": "Logical flow score 1-5."},
            "passed": {"type": "boolean", "description": "True only if ALL scores >= 4."},
            "issues": {
                "type": ["string", "null"],
                "description": "Brief description of issues, or null if passed.",
            },
        },
        "required": ["correctness", "optimality", "clarity", "flow", "passed", "issues"],
        "additionalProperties": False,
    },
}

# ---------------------------------------------------------------------------
# Step decomposition
# ---------------------------------------------------------------------------

DECOMPOSITION_SCHEMA: ToolSchema = {
    "name": "return_decomposition",
    "description": "Return a step-by-step decomposition of a problem.",
    "input_schema": {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Short 2-5 word heading."},
                        "description": {"type": "string", "description": "Full explanation of the step."},
                    },
                    "required": ["title", "description"],
                    "additionalProperties": False,
                },
                "description": "Ordered list of solution steps.",
            },
            "final_answer": {
                "type": "string",
                "description": (
                    "The final simplified answer, formatted as LaTeX using $...$ "
                    "or $$...$$ delimiters. Use single backslashes for LaTeX "
                    "commands (e.g. \\begin{pmatrix}, \\frac, \\sqrt) — do NOT "
                    "double-escape. Example: '$H = \\begin{pmatrix} 1 & 2 \\\\ "
                    "3 & 4 \\end{pmatrix}$'"
                ),
            },
            "answer_type": {
                "type": "string",
                "enum": ["text", "diagram"],
                "description": "Whether the answer is text or a diagram.",
            },
        },
        "required": ["steps", "final_answer", "answer_type"],
        "additionalProperties": False,
    },
}

# ---------------------------------------------------------------------------
# Unit suggestions
# ---------------------------------------------------------------------------

UNIT_SUGGESTIONS_SCHEMA: ToolSchema = {
    "name": "return_suggestions",
    "description": "Return unit classification suggestions for documents.",
    "input_schema": {
        "type": "object",
        "properties": {
            "suggestions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "filename": {"type": "string"},
                        "suggested_unit": {"type": "string"},
                        "is_new": {"type": "boolean"},
                        "confidence": {"type": "number"},
                    },
                    "required": ["filename", "suggested_unit", "is_new", "confidence"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["suggestions"],
        "additionalProperties": False,
    },
}

# ---------------------------------------------------------------------------
# Assignment generation
# ---------------------------------------------------------------------------

GENERATE_QUESTIONS_SCHEMA: ToolSchema = {
    "name": "return_questions",
    "description": "Return generated assignment questions.",
    "input_schema": {
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": (
                                "Short 3-7 word concept label that captures what "
                                "this question is about, in plain English. e.g. "
                                "'Basketball arc — find time at 24 ft', 'Vertex "
                                "form of 2x² − 8x + 5', 'Factoring trinomials'. "
                                "No LaTeX. Max 80 chars."
                            ),
                        },
                        "text": {"type": "string", "description": "The question text."},
                        "difficulty": {
                            "type": "string",
                            "enum": ["easy", "medium", "hard"],
                        },
                    },
                    "required": ["title", "text", "difficulty"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["questions"],
        "additionalProperties": False,
    },
}

# Workshop chat reply: a conversational response plus an OPTIONAL scoped
# proposal. Each proposal field is null when unchanged so the frontend
# only highlights / accepts the actual deltas. Used by the question bank
# workshop chat (see api/core/question_bank_chat.py).
BANK_CHAT_REPLY_SCHEMA: ToolSchema = {
    "name": "return_chat_reply",
    "description": (
        "Reply to the teacher's chat message about a question. Optionally "
        "include a scoped proposal of changes — set fields to null when "
        "they should remain unchanged. Return proposal=null when the "
        "teacher is just asking a question and no edit is needed."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "reply": {
                "type": "string",
                "description": (
                    "Conversational response to the teacher. Keep it short "
                    "(1-3 sentences). Acknowledge the request, mention what "
                    "you changed, or answer the question."
                ),
            },
            "proposal": {
                "type": ["object", "null"],
                "description": (
                    "Scoped revision. Null when no edit is needed. When "
                    "present, set fields to null when they should remain "
                    "unchanged from the current state — only include fields "
                    "the teacher actually wants changed."
                ),
                "properties": {
                    "question": {
                        "type": ["string", "null"],
                        "description": "New question text, or null to leave unchanged.",
                    },
                    "solution_steps": {
                        "type": ["array", "null"],
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "description": {"type": "string"},
                            },
                            "required": ["title", "description"],
                            "additionalProperties": False,
                        },
                        "description": "New solution steps, or null to leave unchanged.",
                    },
                    "final_answer": {
                        "type": ["string", "null"],
                        "description": "New final answer, or null to leave unchanged.",
                    },
                },
                "additionalProperties": False,
            },
        },
        "required": ["reply", "proposal"],
        "additionalProperties": False,
    },
}

# Combined question + worked solution in a single tool call. Used for
# question bank regeneration so we don't pay for two round-trips when
# revising one question.
REGENERATE_QA_SCHEMA: ToolSchema = {
    "name": "return_question_with_solution",
    "description": "Return a single question with its worked step-by-step solution and final answer.",
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": (
                    "Short 3-7 word concept label that captures what this "
                    "question is about, in plain English. No LaTeX. Max 80 chars."
                ),
            },
            "question": {
                "type": "string",
                "description": "The full question text. Use LaTeX with $ delimiters for math.",
            },
            "solution_steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Short 2-5 word heading."},
                        "description": {"type": "string", "description": "Full explanation of the step."},
                    },
                    "required": ["title", "description"],
                    "additionalProperties": False,
                },
                "description": "Ordered list of solution steps.",
            },
            "final_answer": {
                "type": "string",
                "description": (
                    "The final simplified answer, LaTeX-formatted with $ delimiters. "
                    "Use single backslashes for LaTeX commands."
                ),
            },
        },
        "required": ["title", "question", "solution_steps", "final_answer"],
        "additionalProperties": False,
    },
}

# ---------------------------------------------------------------------------
# Image extraction
# ---------------------------------------------------------------------------

IMAGE_EXTRACT_SCHEMA: ToolSchema = {
    "name": "return_extracted_problems",
    "description": "Return problems extracted from an image.",
    "input_schema": {
        "type": "object",
        "properties": {
            "problems": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of extracted problem texts.",
            },
            "confidence": {
                "type": "string",
                "enum": ["high", "medium", "low"],
                "description": "Confidence in the extraction quality.",
            },
        },
        "required": ["problems", "confidence"],
        "additionalProperties": False,
    },
}

# ---------------------------------------------------------------------------
# Work diagnosis
# ---------------------------------------------------------------------------

WORK_DIAGNOSIS_SCHEMA: ToolSchema = {
    "name": "return_diagnosis",
    "description": "Return analysis of student's handwritten work.",
    "input_schema": {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "step_description": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["correct", "error", "skipped", "suboptimal", "unclear"],
                        },
                        "student_work": {"type": "string"},
                        "feedback": {"type": "string"},
                    },
                    "required": ["step_description", "status", "student_work", "feedback"],
                    "additionalProperties": False,
                },
            },
            "summary": {"type": "string", "description": "One-line teaser for summary screen."},
            "has_issues": {"type": "boolean"},
            "overall_feedback": {"type": "string", "description": "Brief overall assessment."},
        },
        "required": ["steps", "summary", "has_issues", "overall_feedback"],
        "additionalProperties": False,
    },
}

# ---------------------------------------------------------------------------
# Integrity checker
# ---------------------------------------------------------------------------

INTEGRITY_EXTRACT_SCHEMA: ToolSchema = {
    "name": "return_extraction",
    "description": "Return the structured extraction of the student's handwritten work.",
    "input_schema": {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "step_num": {"type": "integer"},
                        "problem_position": {
                            "type": ["integer", "null"],
                            "description": (
                                "1-based position of the problem this step "
                                "belongs to, matching the problem list "
                                "provided in the user message. Null when "
                                "the step can't be confidently attributed "
                                "to any one problem (scratch work, notes, "
                                "work spanning multiple problems)."
                            ),
                        },
                        "latex": {"type": "string", "description": "LaTeX representation of this step."},
                        "plain_english": {
                            "type": "string",
                            "description": "Plain-language description of what the student did.",
                        },
                    },
                    "required": [
                        "step_num", "problem_position", "latex", "plain_english",
                    ],
                    "additionalProperties": False,
                },
                "description": "Ordered list of work steps the student wrote, from top to bottom of the page.",
            },
            "final_answers": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "problem_position": {
                            "type": "integer",
                            "description": "1-based position of the problem this answer is for.",
                        },
                        "answer_latex": {
                            "type": "string",
                            "description": (
                                "LaTeX representation of the final answer "
                                "(empty string if the student wrote prose)."
                            ),
                        },
                        "answer_plain": {
                            "type": "string",
                            "description": (
                                "Plain-language version of the final answer. "
                                "Empty string if only LaTeX is meaningful."
                            ),
                        },
                    },
                    "required": [
                        "problem_position", "answer_latex", "answer_plain",
                    ],
                    "additionalProperties": False,
                },
                "description": (
                    "One entry per problem that has a discernible final "
                    "answer on the page, in problem order. Omit problems "
                    "the student didn't answer (or where the final answer "
                    "wasn't separable from the work). The grader reads "
                    "these as the authoritative per-problem answers."
                ),
            },
            "confidence": {
                "type": "number",
                "description": (
                    "0.0 to 1.0 — how confident you are that the extraction "
                    "is accurate. Below 0.3 means the handwriting is unreadable."
                ),
            },
        },
        "required": ["steps", "final_answers", "confidence"],
        "additionalProperties": False,
    },
}

# ---------------------------------------------------------------------------
# AI Grading — per-problem grade output from the text-only grading call
# ---------------------------------------------------------------------------

AI_GRADING_SCHEMA: ToolSchema = {
    "name": "return_grades",
    "description": "Return the per-problem grades for the student's submission.",
    "input_schema": {
        "type": "object",
        "properties": {
            "grades": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "problem_position": {
                            "type": "integer",
                            "description": "1-based position matching the problem order.",
                        },
                        "student_answer": {
                            "type": "string",
                            "description": (
                                "The student's final answer as you understood "
                                "it from the extraction. Wrap math in $...$ "
                                "for inline or $$...$$ for display so the "
                                "teacher sees rendered math, not raw LaTeX."
                            ),
                        },
                        "score_status": {
                            "type": "string",
                            "enum": ["full", "partial", "zero"],
                            "description": "full = 100%, partial = 1-99%, zero = 0%.",
                        },
                        "percent": {
                            "type": "number",
                            "description": "0-100. Forced to 100 for full, 0 for zero. Teacher-meaningful for partial.",
                        },
                        "confidence": {
                            "type": "number",
                            "description": (
                                "Calibrated confidence in this grade, 0.0 to 1.0. "
                                "See the system prompt's calibration bands — be honest, "
                                "don't inflate. Below 0.4 means you're guessing and your "
                                "reasoning should say why."
                            ),
                        },
                        "reasoning": {
                            "type": "string",
                            "description": (
                                "1-2 sentence explanation of why this grade was given. "
                                "Reference the specific rubric criterion (by name) that "
                                "drove the decision."
                            ),
                        },
                    },
                    "required": [
                        "problem_position", "student_answer", "score_status",
                        "percent", "confidence", "reasoning",
                    ],
                    "additionalProperties": False,
                },
                "description": "One grade entry per problem, in problem order.",
            },
        },
        "required": ["grades"],
        "additionalProperties": False,
    },
}

# Agent tool: submit the rubric for a single sampled problem. The
# agent calls this as it moves through problems in the conversation.
# Rejected by the server if zero student turns have been recorded
# yet (the agent must probe at least once before verdicting).
#
# The rubric has six dimensions; paraphrase_originality and
# causal_fluency are always required because the open walkthrough
# produces signal on both. transfer / prediction / authority_resistance
# are optional ("not_probed") because they depend on whether the agent
# chose to ask that kind of follow-up. self_correction is observed
# passively and may be "not_observed" when there wasn't enough turn
# volume to judge.
INTEGRITY_SUBMIT_VERDICT_SCHEMA: ToolSchema = {
    "name": "submit_problem_verdict",
    "description": (
        "Record the rubric for ONE sampled problem. Call this when "
        "you have enough signal to score at least paraphrase_originality "
        "and causal_fluency. You must have had at least one back-and-"
        "forth with the student first."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "problem_id": {
                "type": "string",
                "description": (
                    "UUID of the problem you're verdicting on (from the "
                    "problem list provided at the start)."
                ),
            },
            "rubric": {
                "type": "object",
                "description": (
                    "Six-dimension rubric. paraphrase_originality and "
                    "causal_fluency are required. Others can be "
                    "'not_probed' when you didn't ask that kind of "
                    "question, or 'not_observed' for self_correction when "
                    "you haven't seen enough to judge."
                ),
                "properties": {
                    "paraphrase_originality": {
                        "type": "string",
                        "enum": ["low", "mid", "high"],
                        "description": (
                            "How original vs textbook-verbatim their "
                            "phrasing was. low = generic definitions / "
                            "copy-paste feel. high = clearly their own words."
                        ),
                    },
                    "causal_fluency": {
                        "type": "string",
                        "enum": ["low", "mid", "high"],
                        "description": (
                            "How smoothly they explained WHY, not just "
                            "what. low = disconnected facts or 'just because'. "
                            "high = smooth causal chain linking steps."
                        ),
                    },
                    "transfer": {
                        "type": "string",
                        "enum": ["low", "mid", "high", "not_probed"],
                        "description": (
                            "If you asked a 'what if X were different?' "
                            "twist, how well they handled it."
                        ),
                    },
                    "prediction": {
                        "type": "string",
                        "enum": ["low", "mid", "high", "not_probed"],
                        "description": (
                            "If you asked them to predict the direction "
                            "of an answer before calculating, how well."
                        ),
                    },
                    "authority_resistance": {
                        "type": "string",
                        "enum": ["low", "mid", "high", "not_probed"],
                        "description": (
                            "If you floated a plausible-but-wrong premise, "
                            "did they push back? low = accepted it, "
                            "high = caught and corrected you."
                        ),
                    },
                    "self_correction": {
                        "type": "string",
                        "enum": ["low", "mid", "high", "not_observed"],
                        "description": (
                            "Did they catch their own errors mid-explanation? "
                            "Observed passively — you don't prompt for this."
                        ),
                    },
                },
                "required": ["paraphrase_originality", "causal_fluency"],
                "additionalProperties": False,
            },
            "reasoning": {
                "type": "string",
                "description": (
                    "One sentence, teacher-facing — what swung you to "
                    "these rubric scores."
                ),
            },
        },
        "required": ["problem_id", "rubric", "reasoning"],
        "additionalProperties": False,
    },
}

# Agent tool: generate a fresh isomorphic problem for the inline
# ambiguity disambiguator. Used when the student has correct work on
# paper but cannot articulate any of it AND behavioral signal is clean
# — could be ESL/anxious/bad-at-verbalizing rather than cheating. The
# agent presents the variant in-chat and asks for the APPROACH (not a
# full solution). Call sparingly — once per session max.
INTEGRITY_GENERATE_VARIANT_SCHEMA: ToolSchema = {
    "name": "generate_variant",
    "description": (
        "Generate a fresh isomorphic problem to disambiguate an "
        "ambiguous case (correct work on paper, blank verbal, clean "
        "behavioral). Present it in-chat and ask how the student would "
        "APPROACH it — not to solve it fully. Call at most once per "
        "session."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "problem_id": {
                "type": "string",
                "description": (
                    "UUID of the original problem whose structure the "
                    "variant should mirror."
                ),
            },
        },
        "required": ["problem_id"],
        "additionalProperties": False,
    },
}

# Agent tool: finish the whole check. Call only after every sampled
# problem has a rubric. The server validates coverage and otherwise
# rejects the call.
INTEGRITY_FINISH_CHECK_SCHEMA: ToolSchema = {
    "name": "finish_check",
    "description": (
        "Finish the integrity check. Emit exactly one of four "
        "dispositions based on rubrics + behavioral signals. Call only "
        "after every sampled problem has a submit_problem_verdict."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "disposition": {
                "type": "string",
                "enum": [
                    "pass",
                    "needs_practice",
                    "tutor_pivot",
                    "flag_for_review",
                ],
                "description": (
                    "pass = understood deeply (rubric strong, behavioral "
                    "clean). needs_practice = procedural only (can describe "
                    "steps but can't say why — did the work, thin theory). "
                    "tutor_pivot = student got the problem WRONG on paper "
                    "and is lost (learning, not cheating). flag_for_review = "
                    "correct work on paper but can't explain any of it, "
                    "AND/OR behavioral red flags — teacher reviews."
                ),
            },
            "summary": {
                "type": "string",
                "description": (
                    "One sentence, teacher-facing, summarising the whole "
                    "check."
                ),
            },
            "inline_variant_result": {
                "type": "string",
                "enum": [
                    "specific_approach",
                    "approach_after_followup",
                    "blank_or_wrong",
                    "not_applicable",
                ],
                "description": (
                    "If you used generate_variant to disambiguate, report "
                    "the outcome. specific_approach = student referenced "
                    "concrete structure in their approach (upgrade to pass). "
                    "approach_after_followup = needed a 'first step?' "
                    "follow-up but then gave a reasonable answer (upgrade "
                    "to pass). blank_or_wrong = couldn't articulate an "
                    "approach even after follow-up (confirms flag). "
                    "not_applicable = you didn't use the variant."
                ),
            },
        },
        "required": ["disposition", "summary", "inline_variant_result"],
        "additionalProperties": False,
    },
}
