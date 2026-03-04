"""Tutor endpoints: evaluate, explain (streamed), probe."""

from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from starlette.responses import StreamingResponse

from api.core.tutor import evaluate, explain, probe
from api.routes.sse import sse_stream
from api.schemas.tutor import (
    EvaluateRequest,
    EvaluateResponse,
    ExplainRequest,
    ProbeRequest,
    ProbeResponse,
)

router = APIRouter()


@router.post("/tutor/evaluate", response_model=EvaluateResponse)
async def tutor_evaluate(body: EvaluateRequest) -> EvaluateResponse:
    """Evaluate a student's response against the correct step."""
    try:
        result = await evaluate(
            correct_step=body.correct_step,
            student_response=body.student_response,
            session_id=body.session_id,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Evaluation failed: {e}")

    return EvaluateResponse(is_correct=result.is_correct, feedback=result.feedback)


@router.post("/tutor/explain")
async def tutor_explain(body: ExplainRequest) -> StreamingResponse:
    """Stream an explanation for a step."""

    async def _events() -> AsyncIterator[dict[str, str]]:
        try:
            async for chunk in explain(
                step=body.step,
                error=body.error,
                grade_level=body.grade_level,
                session_id=body.session_id,
            ):
                yield {"type": "chunk", "content": chunk}
            yield {"type": "done"}
        except RuntimeError as e:
            yield {"type": "error", "content": str(e)}

    return await sse_stream(_events())


@router.post("/tutor/probe", response_model=ProbeResponse)
async def tutor_probe(body: ProbeRequest) -> ProbeResponse:
    """Assess a student's explanation of a step."""
    try:
        result = await probe(
            step=body.step,
            student_explanation=body.student_explanation,
            session_id=body.session_id,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Probe failed: {e}")

    return ProbeResponse(understanding=result.understanding, follow_up=result.follow_up)
