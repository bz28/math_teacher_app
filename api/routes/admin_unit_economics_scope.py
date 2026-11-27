"""What /admin/unit-economics measures over: the window and school scope
every query shares, the token-profile columns, and which calls are
"residual" (tied to no submission and no generation job).

Split from admin_unit_economics.py so the queries and the orphaned-call
handling (admin_unit_economics_orphans.py) read the same definitions.
"""

from typing import Any

from sqlalchemy import ColumnElement, Select, and_, exists, func, or_
from sqlalchemy.orm import aliased

from api.core.llm_attribution import SUBMISSION_FUNCTIONS, school_calls
from api.models.assignment import Submission
from api.models.llm_call import LLMCall
from api.models.question_bank import QuestionBankGenerationJob
from api.routes.admin_helpers import INTERNAL_SCHOOL_SENTINEL, Window

# Harness grading calls. They carry a real cost but no customer, and
# including them would price our own test runs into a school's bill.
_EXCLUDED_FUNCTIONS = ("judge",)



class Scope:
    """The filters every query in this endpoint shares."""

    def __init__(
        self, window: Window, school_id: str | None, exclude_internal: bool,
    ) -> None:
        self.window = window
        self.school_id = school_id
        self.exclude_internal = exclude_internal

    @property
    def days(self) -> float:
        span = self.window.end - self.window.start
        return max(span.total_seconds() / 86400.0, 1e-9)

    def filters(self) -> list[Any]:
        out: list[Any] = [
            self.window.covers(LLMCall.created_at),
            LLMCall.function.notin_(_EXCLUDED_FUNCTIONS),
        ]
        if self.school_id == INTERNAL_SCHOOL_SENTINEL:
            out.append(school_calls(None))
        elif self.school_id:
            out.append(school_calls(self.school_id))
        elif self.exclude_internal:
            # school_id IS NULL is founder/admin/test traffic. It looks
            # like a school's usage and would inflate every per-student
            # figure on the page.
            out.append(LLMCall.school_id.isnot(None))
        return out

    def apply(self, stmt: Select[Any]) -> Select[Any]:
        return stmt.where(*self.filters())


    def submission_began_in_window(self) -> ColumnElement[bool]:
        """A submission handed in inside the window (needs Submission joined).

        Calls are cut at the window's edges, so a submission read before
        the window and regraded inside it would count as one whole
        submission carrying only its regrade — a cheap phantom that drags
        the median down, most of all right after a model switch (the
        default window's start). Read off the submission's own
        submitted_at rather than its earliest call: calls before
        SUBMISSION_STAMPED_SINCE carry no submission_id, so a call-based
        test can't see them. A resubmission resets submitted_at, which
        is right — its calls are the new attempt's.
        """
        return Submission.submitted_at >= self.window.start

    def unit_began_in_window(self) -> ColumnElement[bool]:
        """A teaching unit with no generation job before the window (needs
        QuestionBankGenerationJob joined). The same phantom as above: a
        unit built last month that gets one more job today is not one
        whole cheap unit."""
        earlier = aliased(QuestionBankGenerationJob)
        return ~exists().where(
            earlier.unit_id == QuestionBankGenerationJob.unit_id,
            earlier.created_at < self.window.start,
        )


def deleted_generation_calls() -> ColumnElement[bool]:
    """Calls a generation job made whose job is gone.

    A job is deleted with its assignment or course (a teacher discarding
    a draft they generated problems for), and llm_calls.generation_job_id
    is SET NULL. The logger also stamps the job id into call_metadata, which
    survives the delete — that is the only trace that the call was
    generation work and not a teacher's standalone regenerate.
    """
    return and_(
        LLMCall.generation_job_id.is_(None),
        LLMCall.call_metadata.has_key("generation_job_id"),
    )


# filter is what keeps a SUBMISSION-pipeline call whose submission is gone
# (or was never stamped) out of here: it was grading a student's work,
# not tutoring them, and counting it as self-study would spread one
# submission's cost across every active student as a per-student rate.
RESIDUAL = (
    LLMCall.submission_id.is_(None),
    LLMCall.generation_job_id.is_(None),
    LLMCall.function.notin_(SUBMISSION_FUNCTIONS),
    # The same for a generation job's calls whose job was deleted.
    or_(
        LLMCall.call_metadata.is_(None),
        ~LLMCall.call_metadata.has_key("generation_job_id"),
    ),
)


# MEAN, not median. These columns reconstruct a COST: the repriced figure
# is `calls_per_unit x cost(profile)`, and only the mean satisfies
# `sum = mean x count`. A median profile understates every right-skewed
# distribution — and token counts here are explicitly skewed (one student
# photographs forty pages). Worse, the four medians are taken
# INDEPENDENTLY, so a group where fewer than half the calls hit cache has
# `median(cache_read_tokens) = 0` and the repriced figure drops the
# cache-read term that the recorded cost definitely includes.
#
# The median still leads for the DISPLAYED unit cost (_submission_units),
# where resisting one freak submission is exactly what we want. Different
# statistic, different job.
PROFILE_COLS = (
    func.count().label("calls"),
    func.sum(LLMCall.cost_usd).label("cost"),
    func.avg(LLMCall.input_tokens).label("avg_in"),
    func.avg(LLMCall.output_tokens).label("avg_out"),
    func.avg(LLMCall.cache_read_tokens).label("avg_cread"),
    func.avg(LLMCall.cache_write_tokens).label("avg_cwrite"),
)

