"""Fixed-input renders of every versioned LLM prompt.

`tests/data/prompt_snapshots.json` was captured by running `render_samples()`
against the code BEFORE prompts moved into `api/core/prompts/`. The test
re-renders through the current code and asserts byte-identical output, so the
move (or any accidental edit) can't silently change what Claude sees.

Regenerate only when a prompt is changed on purpose (with a version bump):
    python -m tests.prompt_render_samples > tests/data/prompt_snapshots.json
"""

from __future__ import annotations

import hashlib
import importlib
import json
from collections.abc import Callable
from typing import Any

# Every module-level prompt constant (moved, or composed from moved pieces).
CONSTANTS: list[tuple[str, str]] = [
    ("assignment_generation", "FACT_CARD_RULES"),
    ("assignment_generation", "WHEN_TO_DRAW"),
    ("assignment_generation", "_ANSWER_FORM_INSTRUCTIONS"),
    ("assignment_generation", "_CALCULATOR_INSTRUCTIONS"),
    ("assignment_generation", "_CONSTRUCTION_FIGURES_SECTION"),
    ("assignment_generation", "_DIFFICULTY_INSTRUCTIONS"),
    ("assignment_generation", "_FORMAT_INSTRUCTIONS"),
    ("assignment_generation", "_GENERATE_QUESTIONS_TEMPLATE"),
    ("assignment_generation", "_PROBLEM_TYPE_INSTRUCTIONS"),
    ("construction_figures", "CONSTRUCTION_FIGURE_RULES"),
    ("construction_figures", "_FACTS_SYSTEM_A"),
    ("construction_figures", "_FACTS_SYSTEM_B"),
    ("construction_figures", "_FACTS_VOCAB"),
    ("construction_figures", "_REDRAW_SYSTEM"),
    ("drawing_check", "_CHECKLIST_SYSTEM"),
    ("drawing_check", "_CHECK_SYSTEM"),
    ("drawing_requirement", "_CLASSIFY_SYSTEM"),
    ("grading_ai", "_CLASS_RULES_INTRO"),
    ("grading_ai", "_DEFAULT_FULL_CREDIT"),
    ("grading_ai", "_DEFAULT_PARTIAL_CREDIT"),
    ("grading_ai", "_GRADING_SYSTEM"),
    ("graph_feedback", "_SYSTEM"),
    ("image_extract", "_EXTRACT_TEMPLATE"),
    ("integrity_ai", "AGENT_SYSTEM_PROMPT"),
    ("integrity_ai", "DIAGNOSE_WRONG_SYSTEM_PROMPT"),
    ("integrity_ai", "POSTURE_PROMPT_FRAGMENTS"),
    ("integrity_ai", "_EXTRACT_SYSTEM"),
    ("integrity_ai", "_VERIFY_PROMPT"),
    ("integrity_pipeline", "OPENER_TEMPLATES"),
    ("llm_client", "SAFETY_PREAMBLE"),
    ("part_labels", "PRACTICE_SINGLE_ANSWER_RULE"),
    ("practice", "_DIFFICULTY_INSTRUCTIONS"),
    ("practice", "_DISTRACTOR_PROMPT"),
    ("practice", "_GENERATE_QUESTIONS_TEMPLATE"),
    ("question_bank_chat", "_CHAT_CONSTRUCTION_FIGURES"),
    ("question_bank_chat", "_CHAT_SYSTEM_TEMPLATE"),
    ("question_bank_generation", "_EXTRACT_WORKSHEET_TEMPLATE"),
    ("question_bank_generation", "_REGENERATE_SYSTEM_TEMPLATE"),
    ("question_bank_generation", "_REPLACEMENT_RULE"),
    ("step_decomposition", "_CONSTRUCTION_STEP_FIGURES"),
    ("step_decomposition", "_SHAPE_STEP_FIGURES"),
    ("step_decomposition", "_SYSTEM_PROMPT_TEMPLATE"),
    ("tutor", "_ANSWER_EQUIVALENCE_TEMPLATE"),
    ("tutor", "_COMPLETED_CHAT_TEMPLATE"),
    ("tutor", "_STEP_CHAT_TEMPLATE"),
    ("unit_suggestions", "_SUGGEST_UNITS_PROMPT"),
    ("work_diagnosis", "DIAGNOSIS_PROMPT"),
]

POSTURES = ("verified", "struggling_attempted", "struggling_blank", "unknown")
RUBRICS: tuple[dict[str, Any] | None, ...] = (
    None,
    {"full_credit": "FC", "partial_credit": "PC", "common_mistakes": "CM", "notes": "N"},
    {"rules": [{"id": "r1", "text": "Units", "points": 1}]},
)
PROBLEMS = [{"position": 1, "question": "Solve x+1=2", "answer": "x=1", "points": 2}]


def _sha(value: object) -> str:
    text = value if isinstance(value, str) else json.dumps(value, sort_keys=True)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def render_samples() -> dict[str, str]:
    from api.core import (
        assignment_generation,
        grading_ai,
        image_extract,
        integrity_ai,
        integrity_pipeline,
        llm_client,
        practice,
        question_bank_chat,
        question_bank_generation,
        step_decomposition,
        tutor,
        work_diagnosis,
    )
    from api.core.subjects import SUBJECT_CONFIG, get_config

    out: dict[str, Callable[[], object]] = {
        f"raw:{m}.{c}": (lambda m=m, c=c: getattr(importlib.import_module(f"api.core.{m}"), c))
        for m, c in CONSTANTS
    }
    out |= {
        "with_safety:empty": lambda: llm_client._with_safety(""),
        "with_safety:task": lambda: llm_client._with_safety("TASK"),
        "render:work_diagnosis": lambda: work_diagnosis.DIAGNOSIS_PROMPT.format(
            domain="math", problem_text="P", steps="  Step 1: s",
            final_answer="F", user_answer="U", correctness="correct",
        ),
    }
    for i, rubric in enumerate(RUBRICS):
        out[f"render:grading_system:{i}"] = lambda r=rubric: grading_ai._build_system_prompt(r, PROBLEMS)
    for p in POSTURES:
        out[f"render:integrity_agent_system:{p}"] = (
            lambda p=p: integrity_ai.build_agent_system_prompt(p)  # type: ignore[arg-type]
        )
        out[f"render:integrity_kickoff:{p}"] = (
            lambda p=p: integrity_pipeline.build_kickoff_message(p, "BRIEF")  # type: ignore[arg-type]
        )
    for name in ("problem_type", "answer_form", "difficulty", "calculator", "format"):
        for key in getattr(assignment_generation, f"_{name.upper()}_INSTRUCTIONS"):
            out[f"render:assignment_params:{name}:{key}"] = (
                lambda n=name, k=key: assignment_generation._translate_params_to_instructions({n: k})
            )
    for s in (str(getattr(x, "value", x)) for x in SUBJECT_CONFIG):
        cfg = get_config(s)
        role = str(cfg["professor_role"])
        out |= {
            f"render:assignment_generate:{s}": lambda s=s: assignment_generation._build_question_generation_prompt(s),
            f"render:image_extract:{s}": lambda s=s: image_extract._build_extract_prompt(s),
            f"render:practice_generate:{s}": lambda s=s: practice._build_generate_prompt(s),
            f"render:tutor_step_chat:{s}": lambda s=s: tutor._build_step_chat_prompt(s),
            f"render:tutor_completed_chat:{s}": lambda s=s: tutor._build_completed_chat_prompt(s),
            f"render:tutor_answer_equivalence:{s}": lambda s=s: tutor._build_equivalence_prompt(s),
            f"render:bank_chat_system:{s}": lambda r=role: question_bank_chat._chat_system_prompt(r),
            f"render:practice_distractors:{s}": lambda c=cfg: practice._DISTRACTOR_PROMPT.format(
                professor_role=c["professor_role"], domain=c["domain"],
            ),
            f"render:bank_extract_worksheet:{s}": lambda r=role: (
                question_bank_generation._EXTRACT_WORKSHEET_TEMPLATE.format(professor_role=r)
            ),
            f"render:bank_regenerate_system:{s}": lambda r=role: (
                question_bank_generation._REGENERATE_SYSTEM_TEMPLATE.format(professor_role=r)
            ),
        }
        for fig in ("shapes", "construction", "none"):
            out[f"render:step_decomposition:{s}:{fig}"] = (
                lambda s=s, f=fig: step_decomposition._build_system_prompt(s, f)  # type: ignore[arg-type]
            )
    return {k: _sha(fn()) for k, fn in sorted(out.items())}


if __name__ == "__main__":
    print(json.dumps(render_samples(), indent=2, sort_keys=True))
