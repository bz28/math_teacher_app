"""Unit tests for _extract_from_files content-block construction.

The function builds the Anthropic content list from a mixed list of
image and PDF inputs. We mock the LLM call and inspect the content
array that would be sent — this is where the recent rename + content
helper plumbing changes live.
"""

from typing import Any
from unittest.mock import AsyncMock, patch

from api.core.question_bank_generation import _extract_from_files


async def test_extract_from_files_builds_mixed_content_list() -> None:
    captured: dict[str, Any] = {}

    async def fake_vision(content: list[Any], mode: str, **_: Any) -> dict[str, object]:
        captured["content"] = content
        captured["mode"] = mode
        # _extract_from_files reads result.get("questions", [])
        return {"questions": []}

    files = [
        {"data": "JPEG_DATA_B64", "media_type": "image/jpeg"},
        {"data": "PDF_DATA_B64", "media_type": "application/pdf"},
        {"data": "PNG_DATA_B64", "media_type": "image/png"},
    ]

    with patch(
        "api.core.question_bank_generation.call_claude_vision",
        new=AsyncMock(side_effect=fake_vision),
    ):
        result = await _extract_from_files(files, subject="math", user_id="u1")

    assert result == []
    content = captured["content"]
    # Three file blocks + one trailing text instruction.
    assert len(content) == 4
    # Image blocks go through with type=image; PDF flips to type=document.
    assert content[0] == {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/jpeg", "data": "JPEG_DATA_B64"},
    }
    assert content[1] == {
        "type": "document",
        "source": {"type": "base64", "media_type": "application/pdf", "data": "PDF_DATA_B64"},
    }
    assert content[2] == {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": "PNG_DATA_B64"},
    }
    # Final block is the text prompt — copy reads "pages" not "images"
    # so it works for PDFs without sounding off.
    assert content[3]["type"] == "text"
    assert "pages" in content[3]["text"]


async def test_extract_from_files_empty_input_yields_only_text_prompt() -> None:
    captured: dict[str, Any] = {}

    async def fake_vision(content: list[Any], mode: str, **_: Any) -> dict[str, object]:
        captured["content"] = content
        return {"questions": []}

    with patch(
        "api.core.question_bank_generation.call_claude_vision",
        new=AsyncMock(side_effect=fake_vision),
    ):
        await _extract_from_files([], subject="math", user_id="u1")

    # No file blocks; only the trailing text instruction. The empty-list
    # case is a should-not-happen guarded by the caller, but the helper
    # itself should not crash.
    assert len(captured["content"]) == 1
    assert captured["content"][0]["type"] == "text"


async def test_extract_from_files_returns_normalized_questions() -> None:
    async def fake_vision(content: list[Any], mode: str, **_: Any) -> dict[str, object]:
        return {
            "questions": [
                {"title": "Q1", "text": "Solve x", "difficulty": "easy"},
                {"title": "", "text": "Find y", "difficulty": "medium"},
                # Drop malformed entries (no `text` key).
                {"title": "skip me"},
                "not a dict",
            ]
        }

    files = [{"data": "AAAA", "media_type": "image/png"}]

    with patch(
        "api.core.question_bank_generation.call_claude_vision",
        new=AsyncMock(side_effect=fake_vision),
    ):
        result = await _extract_from_files(files, subject="math", user_id="u1")

    assert len(result) == 2
    assert result[0] == {"title": "Q1", "text": "Solve x", "difficulty": "easy"}
    assert result[1] == {"title": "", "text": "Find y", "difficulty": "medium"}
