import uuid

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    problem: str = Field(..., min_length=1, max_length=5000)
    mode: str = Field("learn", pattern=r"^(learn|practice)$")


class CreateMockTestRequest(BaseModel):
    problem: str = Field(..., min_length=1, max_length=5000)


class CompleteMockTestRequest(BaseModel):
    total_questions: int = Field(..., ge=1)
    correct_count: int = Field(..., ge=0)


class RespondRequest(BaseModel):
    student_response: str = Field("", max_length=2000)
    request_advance: bool = False


class StepDetail(BaseModel):
    description: str
    operation: str
    before: str
    after: str
    choices: list[str] | None = None


class SessionResponse(BaseModel):
    id: uuid.UUID
    problem: str
    problem_type: str
    current_step: int
    total_steps: int
    status: str
    mode: str
    steps: list[StepDetail]


class StepResponseSchema(BaseModel):
    action: str
    feedback: str
    current_step: int
    total_steps: int
    is_correct: bool = False
