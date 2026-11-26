"""Versioned LLM prompts — the one place every api/core prompt lives.

Each prompt is a file named ``<name>.v<N>.txt`` (a template, read
byte-for-byte) or ``<name>.v<N>.json`` (a keyed set of fragments).
``PROMPT_VERSIONS`` pins which version is live; each LLM call records the
ids it used (``<name>@v<N>``) in ``llm_calls.call_metadata["prompt_versions"]``
and the harness records them per run.

To change a prompt: add ``<name>.v<N+1>.<ext>``, delete the old file, bump
``PROMPT_VERSIONS``, and update ``hashes.json``. tests/test_prompts.py fails
if a file's bytes change without a new version.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

_DIR = Path(__file__).parent

PROMPT_VERSIONS: dict[str, int] = {
    "assignment_answer_form_instructions": 1,
    "assignment_calculator_instructions": 1,
    "assignment_difficulty_instructions": 1,
    "assignment_format_instructions": 1,
    "assignment_generate_questions": 1,
    "assignment_problem_type_instructions": 1,
    "bank_chat_construction_figures": 1,
    "bank_chat_system": 1,
    "bank_extract_worksheet": 1,
    "bank_regenerate_system": 1,
    "bank_replacement_rule": 1,
    "construction_figure_rules": 1,
    "drawing_check_system": 1,
    "drawing_checklist_system": 1,
    "drawing_requirement_classify": 1,
    "figure_fact_card_rules": 1,
    "figure_facts_system_a": 1,
    "figure_facts_system_b": 1,
    "figure_facts_vocab": 1,
    "figure_redraw_intro": 1,
    "figure_when_to_draw": 1,
    "grading_class_rules_intro": 1,
    "grading_default_full_credit": 1,
    "grading_default_partial_credit": 1,
    "grading_system": 1,
    "graph_feedback_system": 1,
    "image_extract": 1,
    "integrity_agent_system": 1,
    "integrity_answer_equivalence_system": 1,
    "integrity_diagnose_wrong_system": 1,
    "integrity_extract_system": 1,
    "integrity_opener_templates": 1,
    "integrity_posture_fragments": 1,
    "integrity_verify_crop": 1,
    "practice_difficulty_instructions": 1,
    "practice_distractors": 1,
    "practice_generate": 1,
    "practice_single_answer_rule": 1,
    "safety_preamble": 1,
    "step_construction_figures": 1,
    "step_decomposition_system": 1,
    "step_shape_figures": 1,
    "suggest_units": 1,
    "tutor_answer_equivalence": 1,
    "tutor_completed_chat": 1,
    "tutor_step_chat": 1,
    "work_diagnosis": 1,
}


def prompt_version(name: str) -> str:
    """The id logged for a prompt, e.g. ``grading_system@v1``."""
    return f"{name}@v{PROMPT_VERSIONS[name]}"


def prompt_file(name: str, ext: str) -> Path:
    return _DIR / f"{name}.v{PROMPT_VERSIONS[name]}.{ext}"


@cache
def load_prompt(name: str) -> str:
    """A text prompt, byte-for-byte (no newline translation)."""
    return prompt_file(name, "txt").read_bytes().decode("utf-8")


@cache
def load_prompt_map(name: str) -> dict[str, str]:
    """A keyed set of prompt fragments (e.g. one per posture)."""
    data: dict[str, str] = json.loads(prompt_file(name, "json").read_bytes())
    return data
