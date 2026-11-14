"""The streamed student turn (/turn/stream) shows exactly what /turn does.

Streaming only changes WHEN the agent's words arrive. These tests pin the
two halves of that promise for the agent-loop shapes that decide what a
student sees:

- every streamed bubble is a message the turn really shows, word for word,
  in order — never text that's later held back (narration after a rejected
  finish_check), rewritten, or retracted;
- the final `done` event is the same state /turn returns (and a fresh GET
  reads), so the client can replace its streamed bubbles with it.

Each scenario's script and expected transcript mirror a /turn test in
test_integrity_check.py, which pins the non-streamed result for the same
model outputs.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy import func, select

from api.core import integrity_pipeline
from api.database import get_session_factory
from api.models.integrity_check import (
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from tests.conftest import (
    auth_headers as _auth,
)
from tests.conftest import (
    make_text,
    make_tool_use,
    set_agent_script,
)
from tests.test_integrity_check import (
    _CANNED_CLOSING,
    _agent_after_last_student,
    _finish,
    _force_verified_tier,
    _only_problem_id,
    _submit,
    _verdict,
)

_RECOVERY = (
    "Sorry, something went wrong on my end. Could you try sending that again?"
)


def _parse_sse(raw: str) -> list[tuple[str, Any]]:
    events: list[tuple[str, Any]] = []
    for block in raw.split("\n\n"):
        lines = [ln for ln in block.split("\n") if ln and not ln.startswith(":")]
        if not lines:
            continue
        fields = dict(ln.split(": ", 1) for ln in lines)
        events.append((fields["event"], json.loads(fields["data"])))
    return events


async def _stream_turn(
    client: AsyncClient, world: dict[str, Any], submission_id: str,
    body: dict[str, Any],
) -> tuple[list[str], list[tuple[str, Any]], Any]:
    """POST a streamed turn. Returns (bubbles, events, response): the
    text of each streamed bubble as the client would show it (deltas
    joined, trimmed), in bubble order."""
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn/stream",
        headers=_auth(world["student_token"]),
        json=body,
    )
    if r.status_code != 200:
        return [], [], r
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-accel-buffering"] == "no"
    assert "content-encoding" not in r.headers  # never gzip-buffered
    events = _parse_sse(r.text)
    # Exactly one terminal event, and it's last.
    terminal = [e for e, _ in events if e in ("done", "error")]
    assert len(terminal) == 1 and events[-1][0] in ("done", "error")
    bubbles: dict[int, str] = {}
    for name, data in events:
        if name == "delta":
            bubbles[data["bubble"]] = bubbles.get(data["bubble"], "") + data["text"]
    order = sorted(bubbles)
    return [bubbles[b].strip() for b in order], events, r


async def _assert_done_is_authoritative(
    client: AsyncClient, world: dict[str, Any], submission_id: str,
    events: list[tuple[str, Any]],
) -> dict[str, Any]:
    name, done = events[-1]
    assert name == "done"
    state = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )).json()
    assert done == state
    return done


async def test_single_reply_streams_as_one_bubble(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]

    reply = "Good — and why did you divide by 2 there?"
    set_agent_script([[make_text(f"\n  {reply}  \n")]])
    bubbles, events, _ = await _stream_turn(
        client, world, submission_id, {"message": "I split it into two parts."},
    )
    done = await _assert_done_is_authoritative(client, world, submission_id, events)
    assert _agent_after_last_student(done) == [reply]
    assert bubbles == [reply]
    # Leading whitespace never reaches the student, even mid-stream.
    first_delta = next(d for e, d in events if e == "delta")
    assert not first_delta["text"][:1].isspace()


async def test_reply_verdict_and_finish_stream_every_shown_message(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Mirrors test_goodbye_alongside_finish_gets_no_canned_closing."""
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]
    problem_id = await _only_problem_id(submission_id)

    feedback = "Exactly right — that's why the factors work."
    goodbye = "Your proof is in great shape. Thanks for chatting!"
    set_agent_script([
        [make_text(feedback), _verdict(problem_id, "uv1")],
        [
            make_text(goodbye),
            make_tool_use(
                "label_student_reply",
                {"engagement": "answering", "wrapping_up": True},
                use_id="ul1",
            ),
            _finish("uf1"),
        ],
    ])
    bubbles, events, _ = await _stream_turn(
        client, world, submission_id, {"message": "Two numbers that multiply to 6."},
    )
    done = await _assert_done_is_authoritative(client, world, submission_id, events)
    assert done["overall_status"] == "complete"
    assert _agent_after_last_student(done) == [feedback, goodbye]
    assert bubbles == [feedback, goodbye]


async def test_narration_after_rejected_finish_is_never_streamed(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Mirrors test_narration_after_rejected_finish_never_reaches_student:
    the narration is held back as a note, so not one character of it may
    stream."""
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]
    await _force_verified_tier(submission_id)
    problem_id = await _only_problem_id(submission_id)

    goodbye = "Spot on — you clearly understood why it works. Nice job!"
    narration = (
        "The student did answer the what-if twist — let me record that "
        "properly and finalize."
    )
    set_agent_script([
        [_verdict(problem_id, "uv1")],
        [
            make_text(goodbye),
            make_tool_use(
                "label_student_reply",
                {"engagement": "answering", "wrapping_up": True},
                use_id="ul1",
            ),
        ],
        [_finish("uf1")],  # rejected: no conceptual probe scored
        [make_text(narration), _verdict(problem_id, "uv2", transfer="high")],
        [_finish("uf2")],
    ])
    bubbles, events, _ = await _stream_turn(
        client, world, submission_id,
        {"message": "No — without parallel lines the angles aren't equal."},
    )
    done = await _assert_done_is_authoritative(client, world, submission_id, events)
    assert done["overall_status"] == "complete"
    assert _agent_after_last_student(done) == [goodbye]
    assert bubbles == [goodbye]
    assert all("twist" not in d["text"] for e, d in events if e == "delta")


async def test_text_after_a_rejected_goodbye_waits_for_the_final_state(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Mirrors test_probe_after_rejected_finish_reaches_student. After a
    rejected finish following a goodbye, whether the next text is shown
    depends on the rest of its response — so it isn't streamed, and
    arrives (shown, here) with the final state."""
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]
    await _force_verified_tier(submission_id)
    problem_id = await _only_problem_id(submission_id)

    goodbye = "Nice work walking me through that."
    probe = "One quick one: if the 3 were a 5, would x get bigger or smaller?"
    set_agent_script([
        [make_text(goodbye), _verdict(problem_id, "uv1"), _finish("uf1")],
        [make_text(probe)],
    ])
    bubbles, events, _ = await _stream_turn(
        client, world, submission_id,
        {"message": "You factor it and set each one to zero."},
    )
    done = await _assert_done_is_authoritative(client, world, submission_id, events)
    assert _agent_after_last_student(done) == [goodbye, probe]
    assert bubbles == [goodbye]


async def test_reply_after_question_rejection_streams(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Mirrors test_closing_after_question_rejection_reaches_student: the
    rejected finish follows a question, so the student's screen ends on a
    `?` and the replacement closing is shown whatever it holds — it
    streams."""
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]
    problem_id = await _only_problem_id(submission_id)

    question = "Good — and why did you divide by 2 there?"
    closing = "Your work is all set — thanks for chatting through it with me."
    set_agent_script([
        [make_text(question), _verdict(problem_id, "uv1"), _finish("uf1")],
        [make_text(closing), _finish("uf2")],
    ])
    bubbles, events, _ = await _stream_turn(
        client, world, submission_id, {"message": "I split it into two parts."},
    )
    done = await _assert_done_is_authoritative(client, world, submission_id, events)
    assert done["overall_status"] == "complete"
    assert _agent_after_last_student(done) == [question, closing]
    assert bubbles == [question, closing]


async def test_canned_closing_arrives_only_in_the_final_state(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Mirrors test_silent_finish_still_gets_canned_closing."""
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]
    problem_id = await _only_problem_id(submission_id)

    set_agent_script([[_verdict(problem_id, "uv1")], [_finish("uf1")]])
    bubbles, events, _ = await _stream_turn(
        client, world, submission_id, {"message": "Two numbers that multiply to 6."},
    )
    done = await _assert_done_is_authoritative(client, world, submission_id, events)
    assert _agent_after_last_student(done) == [_CANNED_CLOSING]
    assert bubbles == []


async def test_variant_card_is_not_streamed_as_a_plain_bubble(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The message presenting a generated variant renders as the "Quick
    practice" card; streaming it as a plain bubble would change its look
    on arrival, so it comes with the final state."""
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]
    problem_id = await _only_problem_id(submission_id)

    presenter = "Here's a similar one — how would you approach it?"
    with patch(
        "api.core.practice.generate_similar_questions",
        return_value=["Factor 2x^2 + 5x - 3"],
    ):
        set_agent_script([
            [make_tool_use("generate_variant", {"problem_id": problem_id}, use_id="uv1")],
            [make_text(presenter)],
        ])
        bubbles, events, _ = await _stream_turn(
            client, world, submission_id,
            {"message": "I don't really know how to explain it."},
        )
    done = await _assert_done_is_authoritative(client, world, submission_id, events)
    shown = [t for t in done["transcript"] if t["role"] == "agent"]
    assert shown[-1]["content"] == presenter
    assert shown[-1]["is_variant_probe"] is True
    assert bubbles == []


async def test_model_call_failing_mid_response_ends_on_the_recovery_text(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A call that dies after some text streamed: the partial text was
    never saved, and the final state (what the client replaces the
    bubbles with) holds the recovery message, as /turn does."""
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]

    set_agent_script([[make_text("Half a thought"), RuntimeError("stream died")]])
    bubbles, events, _ = await _stream_turn(
        client, world, submission_id, {"message": "I split it into two parts."},
    )
    assert bubbles == ["Half a thought"]
    done = await _assert_done_is_authoritative(client, world, submission_id, events)
    assert _agent_after_last_student(done) == [_RECOVERY]


async def _student_turn_count(submission_id: str) -> int:
    async with get_session_factory()() as s:
        check_id = (await s.execute(
            select(IntegrityCheckSubmission.id)
            .where(IntegrityCheckSubmission.submission_id == submission_id)
        )).scalar_one()
        return int((await s.execute(
            select(func.count()).select_from(IntegrityConversationTurn).where(
                IntegrityConversationTurn.integrity_check_submission_id == check_id,
                IntegrityConversationTurn.role == "student",
            )
        )).scalar_one())


async def test_server_error_after_streaming_saves_nothing(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A crash after text has streamed ends the stream with an `error`
    event (the 500 /turn would answer) and rolls the whole turn back —
    the student's message included — exactly as /turn does."""
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]
    problem_id = await _only_problem_id(submission_id)
    before = await _student_turn_count(submission_id)

    set_agent_script([[make_text("Thanks — let me note that."), _verdict(problem_id, "uv1")]])
    with patch(
        "api.core.integrity_pipeline._apply_tool_call",
        side_effect=RuntimeError("boom"),
    ):
        bubbles, events, _ = await _stream_turn(
            client, world, submission_id, {"message": "I split it into two parts."},
        )
    assert bubbles == ["Thanks — let me note that."]
    assert events[-1] == (
        "error", {"status": 500, "detail": "Something went wrong on our end."},
    )
    assert await _student_turn_count(submission_id) == before


async def test_refused_reply_gets_a_plain_http_error(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Validation happens before any stream starts, so a refused reply
    gets the same status + JSON detail as /turn."""
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]

    _, _, r = await _stream_turn(client, world, submission_id, {"message": "x"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Message must be at least 5 characters"

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/turn/stream",
        headers=_auth(world["outsider_token"]),
        json={"message": "Long enough message"},
    )
    assert r.status_code == 404


async def test_a_quiet_stretch_sends_heartbeats_and_the_turn_still_lands(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """While the loop has nothing to stream (here: slow model calls, the
    first tool-only), the stream sends `: ping` comments so the web
    client's inactivity timeout never fires on a long but healthy turn —
    and the result is unchanged."""
    set_agent_script([[make_text("Opener.")]])
    submission_id = (await _submit(client, world)).json()["submission_id"]
    problem_id = await _only_problem_id(submission_id)

    reply = "Good — and why did you divide by 2 there?"
    set_agent_script([[_verdict(problem_id, "uv1")], [make_text(reply)]])
    real_agent = integrity_pipeline.run_agent_turn

    async def slow_agent(*args: Any, **kwargs: Any) -> Any:
        await asyncio.sleep(0.3)
        return await real_agent(*args, **kwargs)

    with (
        patch("api.routes.integrity_check.STREAM_HEARTBEAT_SECONDS", 0.05),
        patch("api.core.integrity_pipeline.run_agent_turn", side_effect=slow_agent),
    ):
        bubbles, events, r = await _stream_turn(
            client, world, submission_id, {"message": "I split it into two parts."},
        )
    assert r.text.count(": ping\n\n") >= 3
    # Pings are comments: they never surface as events.
    assert {name for name, _ in events} <= {"delta", "done"}
    done = await _assert_done_is_authoritative(client, world, submission_id, events)
    assert _agent_after_last_student(done) == [reply]
    assert bubbles == [reply]
