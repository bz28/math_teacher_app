"""Which stage of the product a logged LLM call belongs to.

The margin simulator has one model choice per STAGE (read handwriting,
grade, understanding check, generate problems, tutor + chat), and the
cost pages roll calls up the same way. This is the one map from a
logged `LLMCall.function` to its stage; the dashboard reads the stage
off the API rather than keeping a copy that drifts.

A stage is not the same as a submission's pipeline buckets: generation
and tutoring are work no single submission does.
"""

from api.core.llm_client import LLMMode

FAMILY_LABELS: dict[str, str] = {
    "vision": "Read handwriting",
    "grading": "Grade",
    "integrity": "Understanding check",
    "generation": "Generate problems",
    "tutoring": "Tutor + chat",
}

_FAMILY_OF: dict[str, str] = {
    fn: family
    for family, fns in {
        "vision": (
            LLMMode.INTEGRITY_EXTRACT, LLMMode.IMAGE_EXTRACT, LLMMode.BANK_EXTRACT,
        ),
        # Graph and drawing checks are part of grading a submission and
        # are logged against one.
        "grading": (
            LLMMode.AI_GRADING, LLMMode.CLASSIFY_REQUIRES_DRAWING,
            LLMMode.GRAPH_CHECKLIST, LLMMode.DRAWING_CHECK, LLMMode.GRAPH_FEEDBACK,
        ),
        "integrity": (
            LLMMode.INTEGRITY_AGENT, LLMMode.INTEGRITY_ANSWER_EQUIVALENCE,
            LLMMode.INTEGRITY_DIAGNOSE_WRONG,
        ),
        "generation": (
            LLMMode.GENERATE_QUESTIONS, LLMMode.GENERATE_DISTRACTORS,
            LLMMode.REGENERATE_BANK_ITEM, LLMMode.PRACTICE_GENERATE,
            # Legacy label over distractors and the tutor's equivalence
            # check before they were split.
            LLMMode.PRACTICE_EVAL, LLMMode.SUGGEST_UNITS,
        ),
        "tutoring": (
            LLMMode.STEP_CHAT, LLMMode.ANSWER_EQUIVALENCE, LLMMode.DECOMPOSE,
            LLMMode.DECOMPOSE_DIAGNOSIS, LLMMode.DIAGNOSE_WORK, LLMMode.BANK_CHAT,
        ),
    }.items()
    for fn in fns
}

# The function NAME cannot tell these apart; only whether the call ran
# inside a generation job can. `decompose` writes a generated problem's
# solution inside a job and tutors a student outside one; the figure
# reader's derived `<mode>_facts_a/_b` labels follow whichever mode
# produced the figure.
_CONTEXT_DEPENDENT = {LLMMode.DECOMPOSE}
_DERIVED_SUFFIXES = ("_facts_a", "_facts_b")


def family_for(function: str, in_generation: bool) -> str:
    """The stage a call sits under; "other" for anything unmapped, which
    is shown, never folded into a priced stage, so a new function
    surfaces instead of skewing a margin."""
    if function in _CONTEXT_DEPENDENT or function.endswith(_DERIVED_SUFFIXES):
        return "generation" if in_generation else "tutoring"
    return _FAMILY_OF.get(function, "other")
