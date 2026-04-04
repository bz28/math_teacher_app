"""AI-powered unit suggestions — classify documents into course units."""

import logging
from typing import Any

from api.core.llm_client import MODEL_CLASSIFY, LLMMode, call_claude_json

logger = logging.getLogger(__name__)


_SUGGEST_UNITS_PROMPT = """\
You are an expert teaching assistant helping a teacher organize course materials.

Given a list of document filenames and the existing units (chapters/topics) in a course,
suggest which unit each document belongs to.

Respond with ONLY valid JSON:
{{"suggestions": [{{"filename": "...", "suggested_unit": "...", "is_new": false, "confidence": 0.9}}]}}

Rules:
- Match each document to the BEST existing unit based on filename, topic, and context
- If no existing unit is a good match, suggest a NEW unit name and set "is_new": true
- If the document is a general/admin file (syllabus, rubric, policies), set "suggested_unit": "Uncategorized"
- confidence: 0.0 to 1.0 — how confident you are in the suggestion
- Use the exact existing unit names when matching (do not rename them)
- Consider common file naming patterns: "ch5" = chapter 5, "hw" = homework, "quiz" = quiz, etc."""


async def suggest_units(
    filenames: list[str],
    existing_units: list[str],
    course_name: str,
    course_subject: str,
    *,
    user_id: str | None = None,
) -> list[dict[str, Any]]:
    """Suggest which unit each document belongs to.

    Args:
        filenames: List of document filenames to classify.
        existing_units: Names of existing units in the course.
        course_name: The course name for context.
        course_subject: The course subject (math, physics, etc.).
        user_id: For LLM call logging.

    Returns:
        List of suggestions: [{filename, suggested_unit, is_new, confidence}]
    """
    if not filenames:
        return []

    units_str = "\n".join(f"- {u}" for u in existing_units) if existing_units else "(no units yet)"
    files_str = "\n".join(f"- {f}" for f in filenames)

    user_message = f"""Course: {course_name} ({course_subject})

Existing units:
{units_str}

Documents to organize:
{files_str}"""

    try:
        result = await call_claude_json(
            _SUGGEST_UNITS_PROMPT,
            user_message,
            mode=LLMMode.SUGGEST_UNITS,
            user_id=user_id,
            model=MODEL_CLASSIFY,
            max_tokens=1024,
        )
        suggestions: list[Any] = result.get("suggestions", [])  # type: ignore[assignment]

        # Validate and normalize — match AI responses back to original filenames
        # because the LLM may return filenames with subtle differences
        ai_by_filename: dict[str, dict[str, Any]] = {}
        for s in suggestions:
            if isinstance(s, dict) and "filename" in s:
                ai_by_filename[s["filename"]] = s

        normalized = []
        for original_name in filenames:
            match = ai_by_filename.get(original_name)
            if not match:
                # Fuzzy fallback: try case-insensitive match
                match = next(
                    (v for k, v in ai_by_filename.items() if k.lower() == original_name.lower()),
                    None,
                )
            normalized.append({
                "filename": original_name,  # always use the original filename
                "suggested_unit": match.get("suggested_unit", "Uncategorized") if match else "Uncategorized",
                "is_new": bool(match.get("is_new", False)) if match else False,
                "confidence": min(1.0, max(0.0, float(match.get("confidence", 0.5)))) if match else 0.0,
            })

        return normalized

    except Exception:
        logger.exception("Failed to get unit suggestions from AI")
        # Fallback: everything uncategorized
        return [
            {"filename": f, "suggested_unit": "Uncategorized", "is_new": False, "confidence": 0.0}
            for f in filenames
        ]
