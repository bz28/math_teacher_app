from pydantic import BaseModel, Field, field_validator

from api.core.subjects import VALID_SUBJECTS


class PracticeGenerateRequest(BaseModel):
    """Batch-generate similar question texts (no answers).

    Use POST /v1/practice/solve for the single-problem solve path that
    decomposes a problem and returns its answer + distractors.
    """

    problems: list[str] = Field(..., min_length=1, max_length=20)
    subject: str = Field("math")
    difficulty: str = Field("same")

    @field_validator("difficulty")
    @classmethod
    def validate_difficulty(cls, v: str) -> str:
        if v not in ("easier", "same", "harder"):
            raise ValueError("difficulty must be one of: easier, same, harder")
        return v

    @field_validator("subject")
    @classmethod
    def validate_subject(cls, v: str) -> str:
        if v not in VALID_SUBJECTS:
            raise ValueError(f"Invalid subject. Must be one of: {', '.join(sorted(VALID_SUBJECTS))}")
        return v


class PracticeSolveRequest(BaseModel):
    """Solve a single problem: decompose, extract answer, generate MC distractors."""

    problem: str = Field(..., min_length=1, max_length=5000)
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


class PracticeSolveResponse(BaseModel):
    problem: PracticeProblem


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
