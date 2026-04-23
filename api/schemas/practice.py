from pydantic import BaseModel, Field, field_validator

from api.core.subjects import VALID_SUBJECTS


class PracticeGenerateRequest(BaseModel):
    problem: str | None = Field(None, min_length=1, max_length=5000)
    problems: list[str] | None = Field(None, min_length=1, max_length=20)
    count: int = Field(0, ge=0, le=20)
    subject: str = Field("math")
    image_base64: str | None = Field(None, max_length=7_000_000)
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


class PracticeProblem(BaseModel):
    question: str
    answer: str
    distractors: list[str] = []


class PracticeGenerateResponse(BaseModel):
    problems: list[PracticeProblem]


class PracticeGenerateFromObjectivesRequest(BaseModel):
    topics: list[str] = Field(..., min_length=1, max_length=50)
    count: int = Field(..., ge=1, le=20)
    level: str | None = Field(None, max_length=20)
    course_name: str | None = Field(None, max_length=120)
    subject: str = Field("math")

    @field_validator("topics")
    @classmethod
    def validate_topics(cls, v: list[str]) -> list[str]:
        cleaned = [t.strip() for t in v if isinstance(t, str) and t.strip()]
        if not cleaned:
            raise ValueError("At least one non-empty topic is required")
        for t in cleaned:
            if len(t) > 200:
                raise ValueError("Each topic must be 200 characters or fewer")
        return cleaned

    @field_validator("level")
    @classmethod
    def validate_level(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v not in ("middle", "hs", "college", "other"):
            raise ValueError("level must be one of: middle, hs, college, other")
        return v

    @field_validator("subject")
    @classmethod
    def validate_subject_obj(cls, v: str) -> str:
        if v not in VALID_SUBJECTS:
            raise ValueError(f"Invalid subject. Must be one of: {', '.join(sorted(VALID_SUBJECTS))}")
        return v


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
