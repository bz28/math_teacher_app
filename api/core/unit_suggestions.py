"""AI-powered unit suggestions — classify documents into course units."""

import logging
from typing import Any

from api.core.document_vision import build_vision_content
from api.core.llm_client import MODEL_CLASSIFY, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import UNIT_SUGGESTIONS_SCHEMA

logger = logging.getLogger(__name__)


_SUGGEST_UNITS_PROMPT = """\
You are an expert teaching assistant helping a teacher organize course materials.

Given a list of document filenames and the existing units (chapters/topics) in a course,
suggest which unit each document belongs to.

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
    images: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Suggest which unit each document belongs to.

    Args:
        filenames: List of document filenames to classify.
        existing_units: Names of existing units in the course.
        course_name: The course name for context.
        course_subject: The course subject (math, physics, etc.).
        user_id: For LLM call logging.
        images: Optional list of {"filename", "base64", "media_type"} from
                fetch_document_images. When provided, Claude reads document
                content instead of guessing from filenames alone.

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
        if images:
            # Batch images (max 10 per call) and run sequentially so each
            # batch knows about new units suggested by previous batches
            batch_size = 10
            all_suggestions: list[Any] = []
            discovered_units: list[str] = []  # new units from prior batches

            for i in range(0, len(images), batch_size):
                batch = images[i:i + batch_size]
                batch_filenames = [img["filename"] for img in batch]
                batch_files_str = "\n".join(f"- {f}" for f in batch_filenames)
                # Include units discovered by earlier batches
                all_units = list(existing_units) + discovered_units
                batch_units_str = "\n".join(f"- {u}" for u in all_units) if all_units else "(no units yet)"
                batch_message = f"""Course: {course_name} ({course_subject})

Existing units:
{batch_units_str}

Documents to organize:
{batch_files_str}"""
                vision_prompt = (
                    f"{_SUGGEST_UNITS_PROMPT}\n\n"
                    "Document images are attached below. Read the actual content "
                    "to determine which unit each document belongs to — do not rely "
                    "solely on the filename.\n\n"
                    f"{batch_message}"
                )
                content = build_vision_content(batch, vision_prompt)
                result = await call_claude_vision(
                    content,
                    mode=LLMMode.SUGGEST_UNITS,
                    tool_schema=UNIT_SUGGESTIONS_SCHEMA,
                    user_id=user_id,
                    model=MODEL_CLASSIFY,
                    max_tokens=2048,
                )
                batch_suggestions = result.get("suggestions", [])
                if isinstance(batch_suggestions, list):
                    all_suggestions.extend(batch_suggestions)
                    # Track new units so subsequent batches can reference them
                    for s in batch_suggestions:
                        if isinstance(s, dict) and s.get("is_new"):
                            name = s.get("suggested_unit", "")
                            if name and name not in discovered_units:
                                discovered_units.append(name)

            # Handle any filenames that had no image (PDFs, missing data)
            image_filenames = {img["filename"] for img in images}
            text_only_filenames = [f for f in filenames if f not in image_filenames]
            if text_only_filenames:
                text_files_str = "\n".join(f"- {f}" for f in text_only_filenames)
                all_units = list(existing_units) + discovered_units
                text_units_str = "\n".join(f"- {u}" for u in all_units) if all_units else "(no units yet)"
                text_message = f"""Course: {course_name} ({course_subject})

Existing units:
{text_units_str}

Documents to organize:
{text_files_str}"""
                text_result = await call_claude_json(
                    _SUGGEST_UNITS_PROMPT,
                    text_message,
                    mode=LLMMode.SUGGEST_UNITS,
                    tool_schema=UNIT_SUGGESTIONS_SCHEMA,
                    user_id=user_id,
                    model=MODEL_CLASSIFY,
                    max_tokens=1024,
                )
                text_suggestions = text_result.get("suggestions", [])
                if isinstance(text_suggestions, list):
                    all_suggestions.extend(text_suggestions)

            suggestions: list[Any] = all_suggestions
        else:
            result = await call_claude_json(
                _SUGGEST_UNITS_PROMPT,
                user_message,
                mode=LLMMode.SUGGEST_UNITS,
                tool_schema=UNIT_SUGGESTIONS_SCHEMA,
                user_id=user_id,
                model=MODEL_CLASSIFY,
                max_tokens=1024,
            )
            suggestions = result.get("suggestions", [])  # type: ignore[assignment]

        # Validate and normalize — match AI responses back to original filenames
        # because the LLM may return filenames with subtle differences
        # (e.g. macOS uses U+202F narrow no-break space before AM/PM in
        # screenshot filenames, but LLMs typically return regular spaces).
        def _normalize_ws(s: str) -> str:
            """Collapse all Unicode whitespace variants into regular ASCII spaces."""
            import re
            return re.sub(r"\s+", " ", s).strip()

        ai_by_filename: dict[str, dict[str, Any]] = {}
        ai_by_normalized: dict[str, dict[str, Any]] = {}
        for s in suggestions:
            if isinstance(s, dict) and "filename" in s:
                ai_by_filename[s["filename"]] = s
                ai_by_normalized[_normalize_ws(s["filename"]).lower()] = s

        normalized = []
        for original_name in filenames:
            match = ai_by_filename.get(original_name)
            if not match:
                # Fuzzy fallback: normalize whitespace + case-insensitive
                match = ai_by_normalized.get(_normalize_ws(original_name).lower())
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
