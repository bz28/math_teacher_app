"""The teacher submission detail surfaces drawings honestly.

Prod bb8536f1: a drawing the zoomed second look could NOT find reached
the teacher's review page as "checked ✓" beside internal pipeline prose.
An unconfirmed entry must come through as `unconfirmed` and never as
`verified`; a confirmed one is unchanged.
"""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Submission
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

pytestmark = pytest.mark.asyncio


def _drawing(**over: Any) -> dict[str, Any]:
    base = {
        "problem_position": 1, "kind": "graph", "present": True,
        "description": "One line through the origin.",
        "plotted_elements": ["line rising through the origin"],
        "labeled_points": [], "answer_on_drawing": None,
        "page_index": 1, "bbox": None, "verified": True,
    }
    return {**base, **over}


async def test_unconfirmed_and_verified_drawings_reach_the_teacher_distinctly(
    client: AsyncClient,
) -> None:
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    extraction = {
        "steps": [], "final_answers": [], "confidence": 0.9,
        "visual_work": [
            _drawing(),
            _drawing(
                kind="diagram", description="Two-column proof layout.",
                plotted_elements=[], verified=False, unconfirmed=True,
            ),
        ],
    }
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == sub_id)
        )).scalar_one()
        sub.extraction = extraction
        await s.commit()

    r = await client.get(
        f"/v1/teacher/submissions/{sub_id}", headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    drawings = next(p for p in r.json()["problems"] if p["position"] == 1)["drawings"]
    checked, unconfirmed = drawings
    assert checked["verified"] is True and checked["unconfirmed"] is False
    assert unconfirmed["verified"] is False and unconfirmed["unconfirmed"] is True
    assert unconfirmed["description"] == "Two-column proof layout."
