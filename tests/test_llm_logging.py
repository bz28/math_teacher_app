"""Pure-unit tests for the LLM-call logging helpers introduced when
LLMCall gained school_id, submission_id, and metadata columns.
"""

from __future__ import annotations

from typing import Any

from api.core.llm_client import _summarize_last_user_message
from api.core.llm_logging import _safe_metadata


class TestSafeMetadata:
    def test_none_passes_through(self) -> None:
        assert _safe_metadata(None) is None

    def test_simple_dict_passes_through(self) -> None:
        meta = {"posture": "verified", "loop_iter": 0}
        assert _safe_metadata(meta) == meta

    def test_oversize_blob_drops_to_none(self) -> None:
        # 4KB cap. A value with ~5KB of content blows past it and the
        # helper returns None rather than truncating (truncated JSON
        # would be invalid).
        big = {"k": "x" * 5_000}
        assert _safe_metadata(big) is None

    def test_non_serializable_drops_to_none(self) -> None:
        class NotSerializable:
            pass

        bad = {"obj": NotSerializable()}
        # NotSerializable falls through default=str and stringifies,
        # so this actually serializes. Use a true non-serializable
        # case: a circular reference.
        circular: dict[str, Any] = {}
        circular["self"] = circular
        assert _safe_metadata(circular) is None
        # The bad-class case with default=str does serialize, so this
        # is intentionally NOT asserted as None — default=str is the
        # documented escape hatch.
        assert _safe_metadata(bad) == bad

    def test_uuid_serializes_via_default_str(self) -> None:
        import uuid

        meta = {"submission_id": str(uuid.uuid4())}
        assert _safe_metadata(meta) == meta


class TestSummarizeLastUserMessage:
    def test_text_user_message(self) -> None:
        messages = [
            {"role": "assistant", "content": "Hi!"},
            {"role": "user", "content": "I factored it."},
        ]
        assert _summarize_last_user_message(messages) == "I factored it."

    def test_walks_back_to_find_user_message(self) -> None:
        # Last message is assistant; helper should pick the user
        # message before it.
        messages = [
            {"role": "user", "content": "I factored it."},
            {"role": "assistant", "content": "Why those numbers?"},
        ]
        assert _summarize_last_user_message(messages) == "I factored it."

    def test_tool_result_block(self) -> None:
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "u1",
                        "content": "accepted: disposition pass",
                    }
                ],
            },
        ]
        assert (
            _summarize_last_user_message(messages)
            == "[tool_result: accepted: disposition pass]"
        )

    def test_no_user_message_returns_none(self) -> None:
        messages = [
            {"role": "assistant", "content": "Hi!"},
        ]
        assert _summarize_last_user_message(messages) is None

    def test_empty_messages_returns_none(self) -> None:
        assert _summarize_last_user_message([]) is None
