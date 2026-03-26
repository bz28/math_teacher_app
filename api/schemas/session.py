import uuid

from pydantic import BaseModel, Field, field_validator, model_validator

from api.core.subjects import VALID_SUBJECTS


class CreateSessionRequest(BaseModel):
    problem: str = Field(..., min_length=1, max_length=5000)
    mode: str = Field("learn", pattern=r"^(learn|practice)$")
    subject: str = Field("math")

    @field_validator("subject")
    @classmethod
    def validate_subject(cls, v: str) -> str:
        if v not in VALID_SUBJECTS:
            raise ValueError(f"Invalid subject. Must be one of: {', '.join(sorted(VALID_SUBJECTS))}")
        return v


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
    subject: str
    steps: list[StepDetail]


class StepResponseSchema(BaseModel):
    action: str
    feedback: str
    current_step: int
    total_steps: int
    is_correct: bool = False
