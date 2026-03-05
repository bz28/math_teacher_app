"""Tests for the tutoring session orchestration.

All tests mock Claude API calls to avoid real API usage in CI.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from api.core.session import (
    _find_matching_steps,
    _generate_hint,
    _validate_step_size,
)
from api.core.step_decomposition import Step

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MOCK_STEPS = [
    Step("Subtract 6 from both sides", "subtraction", "2x + 6 = 12", "2x = 6"),
    Step("Divide both sides by 2", "division", "2x = 6", "x = 3"),
]


WORD_PROBLEM = "A train travels at 60 mph for 3 hours. How far does it go?"
MOCK_WORD_PROBLEM_STEPS = [
    Step("Set up the equation", "translate", WORD_PROBLEM, "d = 60 * 3"),
    Step("Multiply to find the distance", "multiplication", "d = 60 * 3", "d = 180"),
]


def _mock_decomposition():
    from api.core.step_decomposition import Decomposition
    return Decomposition(
        problem="2x + 6 = 12",
        steps=MOCK_STEPS,
        final_answer="x = 3",
        problem_type="linear",
    )


def _mock_word_problem_decomposition():
    from api.core.step_decomposition import Decomposition
    return Decomposition(
        problem=WORD_PROBLEM,
        steps=MOCK_WORD_PROBLEM_STEPS,
        final_answer="d = 180",
        problem_type="word_problem",
    )


def _mock_eval_correct():
    from api.core.tutor import EvalResult
    return EvalResult(is_correct=True, feedback="Correct!")


def _mock_eval_wrong():
    from api.core.tutor import EvalResult
    return EvalResult(is_correct=False, feedback="Not quite. Try again.")


def _mock_converse_correct(steps_completed: int = 0):
    from api.core.tutor import ConverseResult
    return ConverseResult(
        input_type="answer", is_correct=True,
        steps_completed=steps_completed, feedback="Correct!",
    )


def _mock_converse_wrong():
    from api.core.tutor import ConverseResult
    return ConverseResult(
        input_type="answer", is_correct=False,
        steps_completed=None, feedback="Not quite. Try again.",
    )


def _mock_converse_question():
    from api.core.tutor import ConverseResult
    return ConverseResult(
        input_type="question", is_correct=False,
        steps_completed=None, feedback="Think about isolating the variable.",
    )


def _mock_probe_clear():
    from api.core.tutor import ProbeResult
    return ProbeResult(understanding="clear", follow_up=None)


def _mock_probe_partial():
    from api.core.tutor import ProbeResult
    return ProbeResult(understanding="partial", follow_up="Why do we subtract?")


@pytest.fixture
async def auth_token(client: AsyncClient) -> str:
    """Register a test user and return their access token."""
    resp = await client.post("/v1/auth/register", json={
        "email": f"session_test_{uuid.uuid4().hex[:8]}@test.com",
        "password": "TestPass123",
        "grade_level": 8,
    })
    assert resp.status_code == 201
    return resp.json()["access_token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Unit tests: step-size validation
# ---------------------------------------------------------------------------


THREE_STEPS = [
    Step("Subtract 9", "subtraction", "3x + 9 = 18", "3x = 9"),
    Step("Divide by 3", "division", "3x = 9", "x = 3"),
    Step("Simplify", "simplification", "x = 3", "3"),
]


class TestStepSizeValidation:
    def test_valid_single_step(self) -> None:
        is_valid, msg = _validate_step_size("2x = 6", MOCK_STEPS, 0)
        assert is_valid is True

    def test_rejects_skipped_steps(self) -> None:
        # Student jumps from step 0 directly to step 2's answer "3"
        is_valid, msg = _validate_step_size("3", THREE_STEPS, 0)
        assert is_valid is False
        assert "skipped" in (msg or "").lower()

    def test_accepts_one_step_ahead(self) -> None:
        # Jumping 1 step is allowed (not >= 2)
        is_valid, msg = _validate_step_size("x = 3", MOCK_STEPS, 0)
        assert is_valid is True

    def test_accepts_current_step_answer(self) -> None:
        is_valid, msg = _validate_step_size("x = 3", MOCK_STEPS, 1)
        assert is_valid is True

    def test_non_matching_response(self) -> None:
        is_valid, msg = _validate_step_size("x = 99", MOCK_STEPS, 0)
        assert is_valid is True


class TestFindMatchingSteps:
    def test_finds_exact_match(self) -> None:
        matches = _find_matching_steps("2x = 6", MOCK_STEPS, 0)
        assert 0 in matches

    def test_finds_later_step(self) -> None:
        matches = _find_matching_steps("3", MOCK_STEPS, 0)
        assert 1 in matches

    def test_no_match(self) -> None:
        matches = _find_matching_steps("x = 99", MOCK_STEPS, 0)
        assert matches == []


# ---------------------------------------------------------------------------
# Unit tests: hint generation
# ---------------------------------------------------------------------------


class TestHintGeneration:
    def test_hint_level_0_is_vague(self) -> None:
        hint = _generate_hint(MOCK_STEPS[0], 0)
        assert "operation" in hint.lower()

    def test_hint_level_1_is_specific(self) -> None:
        hint = _generate_hint(MOCK_STEPS[0], 1)
        assert "subtraction" in hint.lower()

    def test_hint_level_2_never_reveals_answer(self) -> None:
        hint = _generate_hint(MOCK_STEPS[0], 2)
        # Should not contain the actual answer "2x = 6"
        assert "2x = 6" not in hint


# ---------------------------------------------------------------------------
# Integration tests: session API endpoints (mocked Claude)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_create_session(client: AsyncClient, auth_token: str) -> None:
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["problem"] == "2x + 6 = 12"
    assert data["problem_type"] == "linear"
    assert data["total_steps"] == 2
    assert data["current_step"] == 0
    assert data["status"] == "active"


@pytest.mark.anyio
async def test_get_session(client: AsyncClient, auth_token: str) -> None:
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    resp = await client.get(
        f"/v1/session/{session_id}",
        headers=_auth_headers(auth_token),
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == session_id


@pytest.mark.anyio
async def test_session_not_found(client: AsyncClient, auth_token: str) -> None:
    fake_id = str(uuid.uuid4())
    resp = await client.get(
        f"/v1/session/{fake_id}",
        headers=_auth_headers(auth_token),
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_correct_answer_advances(client: AsyncClient, auth_token: str) -> None:
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    with patch("api.core.session.converse", new_callable=AsyncMock) as mock_converse:
        mock_converse.return_value = _mock_converse_correct(steps_completed=0)

        resp = await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "2x = 6"},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "advance"
    assert data["is_correct"] is True
    assert data["current_step"] == 1


@pytest.mark.anyio
async def test_wrong_answer_gives_feedback(client: AsyncClient, auth_token: str) -> None:
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    with patch("api.core.session.converse", new_callable=AsyncMock) as mock_converse:
        mock_converse.return_value = _mock_converse_wrong()

        resp = await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "wrong answer"},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "error"
    assert data["is_correct"] is False


@pytest.mark.anyio
async def test_hint_request(client: AsyncClient, auth_token: str) -> None:
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    resp = await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "", "request_hint": True},
        headers=_auth_headers(auth_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "hint"


@pytest.mark.anyio
async def test_explain_back_trigger(client: AsyncClient, auth_token: str) -> None:
    """Explain-back triggers after show_step + correct answer."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Request "show step" to reveal the step description
    resp = await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "", "request_show_step": True},
        headers=_auth_headers(auth_token),
    )
    assert resp.json()["action"] == "show_step"
    assert resp.json()["step_description"] is not None

    # Now submit correct answer — explain-back should trigger
    with patch("api.core.session.converse", new_callable=AsyncMock) as mock_converse:
        mock_converse.return_value = _mock_converse_correct(steps_completed=0)

        resp = await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "2x = 6"},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "explain_back"
    assert "explain" in data["feedback"].lower()


@pytest.mark.anyio
async def test_explain_back_clear_advances(client: AsyncClient, auth_token: str) -> None:
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Show step then correct answer to trigger explain-back
    await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "", "request_show_step": True},
        headers=_auth_headers(auth_token),
    )
    with patch("api.core.session.converse", new_callable=AsyncMock) as mock_converse:
        mock_converse.return_value = _mock_converse_correct(steps_completed=0)
        await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "2x = 6"},
            headers=_auth_headers(auth_token),
        )

    # Now submit explain-back
    with patch("api.core.session.probe", new_callable=AsyncMock) as mock_probe:
        mock_probe.return_value = _mock_probe_clear()
        resp = await client.post(
            f"/v1/session/{session_id}/explain-back",
            json={"student_explanation": "I subtracted 6 to isolate x"},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "advance"
    assert data["current_step"] == 1


@pytest.mark.anyio
async def test_explain_back_partial_asks_followup(client: AsyncClient, auth_token: str) -> None:
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Show step then correct answer to trigger explain-back
    await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "", "request_show_step": True},
        headers=_auth_headers(auth_token),
    )
    with patch("api.core.session.converse", new_callable=AsyncMock) as mock_converse:
        mock_converse.return_value = _mock_converse_correct(steps_completed=0)
        await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "2x = 6"},
            headers=_auth_headers(auth_token),
        )

    # Submit weak explain-back
    with patch("api.core.session.probe", new_callable=AsyncMock) as mock_probe:
        mock_probe.return_value = _mock_probe_partial()
        resp = await client.post(
            f"/v1/session/{session_id}/explain-back",
            json={"student_explanation": "I moved the 6"},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "explain_back"
    assert "subtract" in data["feedback"].lower()


@pytest.mark.anyio
async def test_skip_explain_back_advances(client: AsyncClient, auth_token: str) -> None:
    """Skipping explain-back advances without requiring an explanation."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Show step then correct answer to trigger explain-back
    await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "", "request_show_step": True},
        headers=_auth_headers(auth_token),
    )
    with patch("api.core.session.converse", new_callable=AsyncMock) as mock_converse:
        mock_converse.return_value = _mock_converse_correct(steps_completed=0)
        await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "2x = 6"},
            headers=_auth_headers(auth_token),
        )

    # Skip explain-back — should advance without calling probe
    resp = await client.post(
        f"/v1/session/{session_id}/explain-back",
        json={"skip_explain_back": True},
        headers=_auth_headers(auth_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "advance"
    assert data["current_step"] == 1


@pytest.mark.anyio
async def test_session_completion(client: AsyncClient, auth_token: str) -> None:
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    with patch("api.core.session.converse", new_callable=AsyncMock) as mock_converse:
        # Step 1 — correct, completes step 0
        mock_converse.return_value = _mock_converse_correct(steps_completed=0)
        await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "2x = 6"},
            headers=_auth_headers(auth_token),
        )
        # Step 2 (final) — correct, completes step 1
        mock_converse.return_value = _mock_converse_correct(steps_completed=1)
        resp = await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "x = 3"},
            headers=_auth_headers(auth_token),
        )

    data = resp.json()
    assert data["action"] == "completed"
    assert data["similar_problem"] is not None


@pytest.mark.anyio
async def test_unauthenticated_rejected(client: AsyncClient) -> None:
    resp = await client.post("/v1/session", json={"problem": "2x + 6 = 12"})
    assert resp.status_code in (401, 403)


@pytest.mark.anyio
async def test_question_returns_conversation(client: AsyncClient, auth_token: str) -> None:
    """Learn mode: asking a question returns conversation action with guidance."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    with patch("api.core.session.converse", new_callable=AsyncMock) as mock_converse:
        mock_converse.return_value = _mock_converse_question()

        resp = await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "what should I do first?"},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "conversation"
    assert data["is_correct"] is False


@pytest.mark.anyio
async def test_show_step_reveals_description(client: AsyncClient, auth_token: str) -> None:
    """Learn mode: requesting show_step reveals step description."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    resp = await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "", "request_show_step": True},
        headers=_auth_headers(auth_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "show_step"
    assert data["step_description"] == "Subtract 6 from both sides"
    assert data["current_step"] == 0  # hasn't advanced yet


@pytest.mark.anyio
async def test_practice_mode_skip_to_final_answer(client: AsyncClient, auth_token: str) -> None:
    """Practice mode: submitting the final answer directly completes the session."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12", "mode": "practice"},
            headers=_auth_headers(auth_token),
        )
    assert create_resp.status_code == 201
    session_id = create_resp.json()["id"]
    assert create_resp.json()["mode"] == "practice"

    # Submit final answer directly (x = 3) — should complete
    resp = await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "x = 3"},
        headers=_auth_headers(auth_token),
    )
    data = resp.json()
    assert data["action"] == "completed"
    assert data["is_correct"] is True
    assert data["similar_problem"] is not None


@pytest.mark.anyio
async def test_practice_mode_intermediate_step(client: AsyncClient, auth_token: str) -> None:
    """Practice mode: submitting an intermediate step is rejected (final-answer-only)."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12", "mode": "practice"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Submit intermediate step (2x = 6) — should be rejected (not the final answer)
    with patch("api.core.session._llm_check_final_answer", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = False
        resp = await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "2x = 6"},
            headers=_auth_headers(auth_token),
        )
    data = resp.json()
    assert data["action"] == "error"
    assert data["is_correct"] is False
    assert data["current_step"] == 0


@pytest.mark.anyio
async def test_practice_mode_wrong_answer(client: AsyncClient, auth_token: str) -> None:
    """Practice mode: submitting a wrong answer returns error feedback."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12", "mode": "practice"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Submit wrong answer — no symbolic match, LLM also says wrong
    with patch("api.core.session._llm_check_final_answer", new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = False
        resp = await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "x = 99"},
            headers=_auth_headers(auth_token),
        )
    data = resp.json()
    assert data["action"] == "error"
    assert data["is_correct"] is False
    assert "incorrect" in data["feedback"].lower()


@pytest.mark.anyio
async def test_practice_mode_no_step_skip_rejection(client: AsyncClient, auth_token: str) -> None:
    """Practice mode: skipping steps is allowed (no skip_rejected action)."""
    from api.core.step_decomposition import Decomposition

    three_step = Decomposition(
        problem="3x + 9 = 18",
        steps=[
            Step("Subtract 9 from both sides", "subtraction", "3x + 9 = 18", "3x = 9"),
            Step("Divide both sides by 3", "division", "3x = 9", "x = 3"),
            Step("Simplify", "simplification", "x = 3", "3"),
        ],
        final_answer="3",
        problem_type="linear",
    )

    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = three_step
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "3x + 9 = 18", "mode": "practice"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # In learn mode this would be rejected (skip 2+ steps). In practice mode, it completes.
    resp = await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "3"},
        headers=_auth_headers(auth_token),
    )
    data = resp.json()
    assert data["action"] == "completed"
    assert data["is_correct"] is True


@pytest.mark.anyio
async def test_word_problem_session(client: AsyncClient, auth_token: str) -> None:
    """Test that a word problem creates a session with 'Set up the equation' as step 1."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_word_problem_decomposition()
        resp = await client.post(
            "/v1/session",
            json={"problem": WORD_PROBLEM},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["problem_type"] == "word_problem"
    assert data["total_steps"] == 2
    assert data["current_step"] == 0
    assert data["status"] == "active"
