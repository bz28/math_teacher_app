from pydantic import BaseModel, Field


class PracticeGenerateRequest(BaseModel):
    problem: str = Field(..., min_length=1, max_length=5000)
    count: int = Field(3, ge=0, le=20)


class PracticeProblem(BaseModel):
    question: str
    answer: str


class PracticeGenerateResponse(BaseModel):
    problems: list[PracticeProblem]


class PracticeCheckRequest(BaseModel):
    question: str = Field(..., max_length=5000)
    correct_answer: str = Field(..., max_length=2000)
    user_answer: str = Field(..., max_length=2000)


class PracticeCheckResponse(BaseModel):
    is_correct: bool
