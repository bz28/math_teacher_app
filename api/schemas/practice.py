from pydantic import BaseModel, Field, field_validator

from api.core.subjects import VALID_SUBJECTS


class PracticeGenerateRequest(BaseModel):
    problem: str | None = Field(None, min_length=1, max_length=5000)
    problems: list[str] | None = Field(None, min_length=1, max_length=20)
    count: int = Field(0, ge=0, le=20)
    subject: str = Field("math")
    image_base64: str | None = Field(None, max_length=7_000_000)

    @field_validator("subject")
    @classmethod
    def validate_subject(cls, v: str) -> str:
        if v not in VALID_SUBJECTS:
            raise ValueError(f"Invalid subject. Must be one of: {', '.join(sorted(VALID_SUBJECTS))}")
        return v


class PracticeProblem(BaseModel):
    question: str
    answer: str
    distractors: list[str] = []


class PracticeGenerateResponse(BaseModel):
    problems: list[PracticeProblem]


class PracticeCheckRequest(BaseModel):
    question: str = Field(..., max_length=5000)
    correct_answer: str = Field(..., max_length=2000)
    user_answer: str = Field(..., max_length=2000)
    subject: str = Field("math")

    @field_validator("subject")
    @classmethod
    def validate_subject(cls, v: str) -> str:
        if v not in VALID_SUBJECTS:
            raise ValueError(f"Invalid subject. Must be one of: {', '.join(sorted(VALID_SUBJECTS))}")
        return v


class PracticeCheckResponse(BaseModel):
    is_correct: bool
