import uuid

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    problem: str = Field(..., min_length=1, max_length=5000)
    mode: str = Field("learn", pattern=r"^(learn|practice)$")


class RespondRequest(BaseModel):
    student_response: str = Field("", max_length=2000)
    request_hint: bool = False
    request_show_step: bool = False
    request_advance: bool = False


class StepDetail(BaseModel):
    description: str
    operation: str
    before: str
    after: str
    choices: list[str] | None = None


class StepTrackingInfo(BaseModel):
    attempts: int = 0
    hints_used: int = 0


class SessionResponse(BaseModel):
    id: uuid.UUID
    problem: str
    problem_type: str
    current_step: int
    total_steps: int
    status: str
    mode: str
    steps: list[StepDetail]
    step_tracking: dict[str, StepTrackingInfo]


class StepResponseSchema(BaseModel):
    action: str
    feedback: str
    current_step: int
    total_steps: int
    is_correct: bool = False
    similar_problem: str | None = None
    step_description: str | None = None
