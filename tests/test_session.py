"""Tests for the tutoring session orchestration.

All tests mock Claude API calls to avoid real API usage in CI.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from api.core.llm_client import _circuit
from api.core.step_decomposition import Decomposition


def _mock_practice_decomposition(problem: str, answer: str) -> Decomposition:
    """Create a mock Decomposition for practice mode tests."""
    return Decomposition(
        problem=problem,
        steps=["Solve the equation"],
        final_answer=answer,
        problem_type="math",
        distractors=["wrong1", "wrong2", "wrong3"],
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MOCK_STEPS = [
    "Subtract 6 from both sides to get 2x = 6",
    "Divide both sides by 2 to get x = 3",
]


WORD_PROBLEM = "A train travels at 60 mph for 3 hours. How far does it go?"
MOCK_WORD_PROBLEM_STEPS = [
    "Set up the equation: d = 60 * 3",
    "Multiply to find the distance: d = 180",
]


def _mock_decomposition():
    from api.core.step_decomposition import Decomposition
    return Decomposition(
        problem="2x + 6 = 12",
        steps=MOCK_STEPS,
        final_answer="x = 3",
        problem_type="linear",
        distractors=["x = 2", "x = 6", "x = -3"],
    )


def _mock_word_problem_decomposition():
    from api.core.step_decomposition import Decomposition
    return Decomposition(
        problem=WORD_PROBLEM,
        steps=MOCK_WORD_PROBLEM_STEPS,
        final_answer="d = 180",
        problem_type="word_problem",
        distractors=["d = 120", "d = 60", "d = 200"],
    )


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


def _mock_completed_chat():
    from api.core.tutor import StepChatResult
    return StepChatResult(feedback="We subtracted 6 first to isolate the variable term.")


@pytest.fixture
async def auth_token(client: AsyncClient) -> str:
    """Register a test user and return their access token."""
    resp = await client.post("/v1/auth/register", json={
        "email": f"session_test_{uuid.uuid4().hex[:8]}@test.com",
        "password": "TestPass123",
        "name": "Test",
        "grade_level": 8,
    })
    assert resp.status_code == 201
    return resp.json()["access_token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _reset_circuit_breaker() -> None:
    """Reset the global circuit breaker before each test."""
    _circuit.reset()


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
    """Learn mode: clicking 'I understand' on a non-final step advances."""
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
        json={"student_response": "", "request_advance": True},
        headers=_auth_headers(auth_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "advance"
    assert data["is_correct"] is True
    assert data["current_step"] == 1


@pytest.mark.anyio
async def test_wrong_answer_gives_feedback(client: AsyncClient, auth_token: str) -> None:
    """Learn mode: wrong answer on the final step gives error feedback."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Advance past non-final step first
    await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "", "request_advance": True},
        headers=_auth_headers(auth_token),
    )

    # Now on final step — submit wrong answer (multiple-choice: just string match)
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
async def test_step_chat_question(client: AsyncClient, auth_token: str) -> None:
    """Learn mode: asking a question on a non-final step uses step_chat."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    with patch("api.core.session.step_chat", new_callable=AsyncMock) as mock_chat:
        from api.core.tutor import StepChatResult
        mock_chat.return_value = StepChatResult(feedback="We subtract 6 to isolate x.")

        resp = await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "Why do we subtract 6?"},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "conversation"


@pytest.mark.anyio
async def test_advance_then_correct_final_answer(client: AsyncClient, auth_token: str) -> None:
    """Learn mode: advance non-final step, then submit correct final answer."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Advance past step 0
    resp = await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "", "request_advance": True},
        headers=_auth_headers(auth_token),
    )
    assert resp.json()["action"] == "advance"
    assert resp.json()["current_step"] == 1

    # Submit correct answer for final step (x = 3)
    resp = await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "x = 3"},
        headers=_auth_headers(auth_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "completed"
    assert data["is_correct"] is True


@pytest.mark.anyio
async def test_continue_asking_after_completion(client: AsyncClient, auth_token: str) -> None:
    """After completing a problem, students can keep asking the tutor questions."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Advance past step 0 (non-final)
    await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "", "request_advance": True},
        headers=_auth_headers(auth_token),
    )

    # Submit correct answer for final step
    await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "x = 3"},
        headers=_auth_headers(auth_token),
    )

    # Now ask a question on the completed session
    with patch("api.core.session.completed_chat", new_callable=AsyncMock) as mock_chat:
        mock_chat.return_value = _mock_completed_chat()
        resp = await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "why did we subtract 6 first?"},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "conversation"


@pytest.mark.anyio
async def test_session_completion(client: AsyncClient, auth_token: str) -> None:
    """Learn mode: advance non-final steps, then submit correct final answer."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Advance past step 0 (non-final)
    await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "", "request_advance": True},
        headers=_auth_headers(auth_token),
    )

    # Submit correct answer for final step (x = 3)
    resp = await client.post(
        f"/v1/session/{session_id}/respond",
        json={"student_response": "x = 3"},
        headers=_auth_headers(auth_token),
    )

    data = resp.json()
    assert data["action"] == "completed"


@pytest.mark.anyio
async def test_unauthenticated_rejected(client: AsyncClient) -> None:
    resp = await client.post("/v1/session", json={"problem": "2x + 6 = 12"})
    assert resp.status_code in (401, 403)


@pytest.mark.anyio
async def test_question_returns_conversation(client: AsyncClient, auth_token: str) -> None:
    """Learn mode: asking a question on a non-final step returns conversation."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    with patch("api.core.session.step_chat", new_callable=AsyncMock) as mock_chat:
        from api.core.tutor import StepChatResult
        mock_chat.return_value = StepChatResult(feedback="Think about isolating the variable.")

        resp = await client.post(
            f"/v1/session/{session_id}/respond",
            json={"student_response": "what should I do first?"},
            headers=_auth_headers(auth_token),
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "conversation"


@pytest.mark.anyio
async def test_learn_mode_steps_visible_in_session(client: AsyncClient, auth_token: str) -> None:
    """Learn mode: steps are visible in the session response."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_decomposition()
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12"},
            headers=_auth_headers(auth_token),
        )
    assert create_resp.status_code == 201
    data = create_resp.json()
    assert len(data["steps"]) == 2
    assert data["steps"][0]["description"] == "Subtract 6 from both sides to get 2x = 6"
    assert data["current_step"] == 0


@pytest.mark.anyio
async def test_practice_mode_skip_to_final_answer(client: AsyncClient, auth_token: str) -> None:
    """Practice mode: submitting the final answer directly completes the session."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_practice_decomposition("2x + 6 = 12", "x = 3")
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


@pytest.mark.anyio
async def test_practice_mode_intermediate_step(client: AsyncClient, auth_token: str) -> None:
    """Practice mode: submitting a wrong answer is rejected."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_practice_decomposition("2x + 6 = 12", "x = 3")
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12", "mode": "practice"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Submit intermediate step (2x = 6) — not the final answer
    with patch("api.core.session.check_answer", new_callable=AsyncMock) as mock_check:
        mock_check.return_value = False
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
        mock_decompose.return_value = _mock_practice_decomposition("2x + 6 = 12", "x = 3")
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "2x + 6 = 12", "mode": "practice"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

    # Submit wrong answer — no symbolic match, LLM also says wrong
    with patch("api.core.session.check_answer", new_callable=AsyncMock) as mock_check:
        mock_check.return_value = False
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
    """Practice mode: any correct final answer completes the session."""
    with patch("api.core.session.decompose_problem", new_callable=AsyncMock) as mock_decompose:
        mock_decompose.return_value = _mock_practice_decomposition("3x + 9 = 18", "3")
        create_resp = await client.post(
            "/v1/session",
            json={"problem": "3x + 9 = 18", "mode": "practice"},
            headers=_auth_headers(auth_token),
        )
    session_id = create_resp.json()["id"]

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
