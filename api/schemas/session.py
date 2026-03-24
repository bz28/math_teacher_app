import uuid

from pydantic import BaseModel, Field, model_validator


class CreateSessionRequest(BaseModel):
    problem: str = Field(..., min_length=1, max_length=5000)
    mode: str = Field("learn", pattern=r"^(learn|practice)$")


class CreateMockTestRequest(BaseModel):
    problem: str = Field(..., min_length=1, max_length=5000)


class CompleteMockTestRequest(BaseModel):
    total_questions: int = Field(..., ge=1)
    correct_count: int = Field(..., ge=0)

    @model_validator(mode="after")
    def check_correct_within_total(self) -> "CompleteMockTestRequest":
        if self.correct_count > self.total_questions:
            raise ValueError("correct_count cannot exceed total_questions")
        return self


class RespondRequest(BaseModel):
    student_response: str = Field("", max_length=2000)
    request_advance: bool = False


class StepDetail(BaseModel):
    description: str
    final_answer: str | None = None
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
