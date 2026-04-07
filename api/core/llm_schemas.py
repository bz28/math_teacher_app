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
                        "text": {"type": "string", "description": "The question text."},
                        "difficulty": {
                            "type": "string",
                            "enum": ["easy", "medium", "hard"],
                        },
                    },
                    "required": ["text", "difficulty"],
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
        "required": ["question", "solution_steps", "final_answer"],
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
