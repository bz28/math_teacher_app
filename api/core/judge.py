"""LLM-as-judge: evaluate decomposition quality in the background."""

import asyncio
import logging
import uuid

from api.core.llm_client import MODEL_CLASSIFY, LLMMode, call_claude_json

logger = logging.getLogger(__name__)

JUDGE_PROMPT = (
    "You are a strict quality evaluator for a math tutoring app. "
    "You will receive a math problem and the step-by-step solution shown to students.\n\n"
    "Rate the solution on 4 dimensions (1-5 each):\n"
    "- correctness: Is the math correct? Is the final answer right?\n"
    "- optimality: Was this the best/fastest approach? Or was there a simpler way?\n"
    "- clarity: Are the steps easy to follow? Is the reasoning explained before the math?\n"
    "- flow: Does each step logically lead to the next? No confusing jumps?\n\n"
    "Also set passed=true only if ALL scores are >= 4.\n"
    "If any score is below 4, explain the issues briefly in the issues field.\n\n"
    "Respond with ONLY valid JSON:\n"
    '{"correctness": 5, "optimality": 4, "clarity": 5, "flow": 4, '
    '"passed": true, "issues": null}'
)

# Keep background tasks alive until done
_background_tasks: set[asyncio.Task[None]] = set()


def _task_done(task: asyncio.Task[None]) -> None:
    _background_tasks.discard(task)
    if not task.cancelled() and task.exception():
        logger.error("Quality judge task failed: %s", task.exception())


async def _evaluate_and_persist(
    problem: str,
    steps: list[str],
    final_answer: str,
    session_id: str,
) -> None:
    """Call the judge LLM and persist the score to the database."""
    steps_text = "\n".join(f"  Step {i + 1}: {s}" for i, s in enumerate(steps))
    user_message = (
        f"Problem: {problem}\n\n"
        f"Solution steps:\n{steps_text}\n\n"
        f"Final answer: {final_answer}"
    )

    try:
        data = await call_claude_json(
            JUDGE_PROMPT,
            user_message,
            mode=LLMMode.JUDGE,
            model=MODEL_CLASSIFY,
            max_tokens=256,
            session_id=session_id,
        )

        correctness = int(data.get("correctness", 0))
        optimality = int(data.get("optimality", 0))
        clarity = int(data.get("clarity", 0))
        flow = int(data.get("flow", 0))
        passed = bool(data.get("passed", False))
        issues = data.get("issues")

        from api.database import get_session_factory
        from api.models import session as _session_model  # noqa: F811
        from api.models.quality_score import QualityScore

        _ = _session_model  # ensure Session table is registered in metadata

        async with get_session_factory()() as db:
            score = QualityScore(
                session_id=uuid.UUID(session_id),
                correctness=correctness,
                optimality=optimality,
                clarity=clarity,
                flow=flow,
                passed=passed,
                issues=str(issues) if issues else None,
            )
            db.add(score)
            await db.commit()

        logger.info(
            "Quality judge: session=%s pass=%s scores=%d/%d/%d/%d",
            session_id, passed, correctness, optimality, clarity, flow,
        )

    except Exception:
        logger.exception("Quality judge failed for session %s", session_id)


def fire_and_forget_judge(
    problem: str,
    steps: list[str],
    final_answer: str,
    session_id: str,
) -> None:
    """Schedule quality evaluation as a fire-and-forget background task."""
    try:
        task = asyncio.get_running_loop().create_task(
            _evaluate_and_persist(problem, steps, final_answer, session_id)
        )
        _background_tasks.add(task)
        task.add_done_callback(_task_done)
    except RuntimeError:
        logger.warning("No running event loop — skipping quality judge")
