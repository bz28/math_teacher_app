"""A unit in the read final answer that the work never shows is pointed
out to the teacher (prod, Oct 2026: "16·sin 80 = 15.76" read as
"15.76 ft", "15.26" as "15.26°" — teachers took points off for the
missing units the AI had credited)."""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.answer_units import units_in, units_not_in_work
from api.database import get_session_factory
from api.models.assignment import Submission
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw


@pytest.mark.parametrize(("text", "units"), [
    (r"15.76 \text{ ft}", {"ft"}),
    (r"15.76\,\text{feet}", {"ft"}),
    (r"15.26^\circ", {"°"}),
    ("74.74°", {"°"}),
    (r"48\pi \text{ rad/min}", {"rad", "min"}),
    ("about 12 feet per minute", {"ft", "min"}),
    (r"12 \text{ square feet}", {"ft"}),
    (r"5 \text{ ft}, 6 \text{ in}", {"ft", "in"}),
])
def test_units_after_a_number_are_found(text: str, units: set[str]) -> None:
    assert units_in(text) == units


@pytest.mark.parametrize("text", [
    "x = 3", "3m + 2", "y = 2x - 4", r"\text{min}(a, b)", r"x = 2 \text{ in quadrant II}",
    "15 feet tall", r"\text{The answer is } 5", "(3, 4)", r"2\sin x",
])
def test_variables_and_prose_are_not_units(text: str) -> None:
    assert units_in(text) == set()


def test_a_unit_the_work_never_shows_is_flagged() -> None:
    steps = [{"latex": r"16 \sin 80^{\circ}"}, {"latex": "= 15.76"}]
    # The ° in the steps is the question's angle; the ft appears nowhere.
    assert units_not_in_work(r"15.76 \text{ ft}", steps) == ["ft"]


def test_a_unit_written_in_the_work_is_not_flagged() -> None:
    steps = [{"latex": r"16 \sin 80^{\circ} = 15.76 \text{ ft}"}]
    assert units_not_in_work(r"15.76 \text{ ft}", steps) == []


def test_the_readers_prose_does_not_count_as_work() -> None:
    # Prod P3: the narration says "degrees", the transcription doesn't.
    steps = [{"latex": r"\tan^{-1}(0.273) = 15.26", "plain_english": "so the angle is 15.26 degrees"}]
    assert units_not_in_work(r"15.26^\circ", steps) == ["°"]


def test_a_prose_only_step_counts_as_work() -> None:
    steps = [{"latex": "", "plain_english": "The ladder reaches 15.76 feet up the wall"}]
    assert units_not_in_work(r"15.76 \text{ ft}", steps) == []


def test_no_steps_means_nothing_to_compare() -> None:
    assert units_not_in_work("33°", []) == []


@pytest.mark.asyncio
async def test_the_teacher_sees_units_missing_from_the_work(client: AsyncClient) -> None:
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    extraction: dict[str, Any] = {
        "confidence": 0.9,
        "steps": [{"problem_position": 1, "step_num": 1, "latex": r"16 \sin 80 = 15.76", "plain_english": ""}],
        "final_answers": [{"problem_position": 1, "answer_latex": r"15.76 \text{ ft}", "answer_plain": "15.76 ft"}],
    }
    async with get_session_factory()() as s:
        sub = (await s.execute(select(Submission).where(Submission.id == sub_id))).scalar_one()
        sub.extraction = extraction
        await s.commit()

    r = await client.get(f"/v1/teacher/submissions/{sub_id}", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    problems = {p["position"]: p for p in r.json()["problems"]}
    assert problems[1]["units_not_in_work"] == ["ft"]
    assert all(p["units_not_in_work"] == [] for pos, p in problems.items() if pos != 1)
