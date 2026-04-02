"""Subject registry: prompt fragments and config for each supported subject."""

from enum import StrEnum


class Subject(StrEnum):
    MATH = "math"
    CHEMISTRY = "chemistry"
    PHYSICS = "physics"
    CS = "cs"


VALID_SUBJECTS = frozenset(s.value for s in Subject)

# ---------------------------------------------------------------------------
# Per-subject prompt fragments — injected into shared prompt templates.
# Adding a new subject = adding a new entry here. No other prompt changes needed.
# ---------------------------------------------------------------------------

SUBJECT_CONFIG: dict[str, dict[str, object]] = {
    Subject.MATH: {
        "professor_role": (
            "worldclass math professor with expertise in breaking down "
            "math problems into easy to understand, coherent steps, making even the most "
            "complex problems trivial to understand to an elementary student"
        ),
        "tutor_role": "math tutor",
        "domain": "math",
        "problems_noun": "math problems",
        "equivalence_adjective": "MATHEMATICALLY",
        "equivalence_examples": (
            '- "35" does NOT match "35x^4" — the variable/exponent is missing\n'
            "- Partial answers or answers missing terms are WRONG"
        ),
        "function_names": {
            "sin", "cos", "tan", "log", "ln", "abs",
            "max", "min", "mod", "gcd", "lcm", "sqrt",
        },
    },
    Subject.CHEMISTRY: {
        "professor_role": (
            "worldclass chemistry professor with expertise in breaking down "
            "chemistry problems into easy to understand, coherent steps, making even the most "
            "complex problems trivial to understand to an elementary student"
        ),
        "tutor_role": "chemistry tutor",
        "domain": "chemistry",
        "problems_noun": "chemistry problems",
        "equivalence_adjective": "SCIENTIFICALLY",
        "equivalence_examples": (
            '- "NaCl" does NOT match "Na + Cl" — the compound vs ions matters\n'
            "- Partial answers or answers missing units/coefficients are WRONG"
        ),
        "function_names": set(),
    },
    Subject.PHYSICS: {
        "professor_role": (
            "worldclass physics professor with expertise in breaking down "
            "physics problems into easy to understand, coherent steps, making even the most "
            "complex problems trivial to understand to an elementary student"
        ),
        "tutor_role": "physics tutor",
        "domain": "physics",
        "problems_noun": "physics problems",
        "equivalence_adjective": "PHYSICALLY",
        "equivalence_examples": (
            '- "10 m/s" does NOT match "10" — units are required\n'
            "- Partial answers or answers missing units/direction are WRONG"
        ),
        "function_names": {
            "sin", "cos", "tan", "log", "ln", "sqrt", "abs",
        },
    },
    Subject.CS: {
        "professor_role": (
            "worldclass computer science professor with expertise in data structures, "
            "algorithms, system design, and writing clean optimal code, able to break down "
            "complex CS problems into easy to understand, coherent steps, making even the most "
            "advanced concepts trivial to understand to a beginner"
        ),
        "tutor_role": "computer science tutor",
        "domain": "computer science",
        "problems_noun": "computer science problems",
        "equivalence_adjective": "LOGICALLY",
        "equivalence_examples": (
            '- "O(n)" does NOT match "O(n log n)" — complexity must be exact\n'
            "- Partial answers or answers missing complexity/units are WRONG"
        ),
        "function_names": set(),
    },
}


def get_config(subject: str) -> dict[str, object]:
    """Return the prompt config for a subject, defaulting to math."""
    return SUBJECT_CONFIG.get(subject, SUBJECT_CONFIG[Subject.MATH])
