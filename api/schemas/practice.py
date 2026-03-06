from pydantic import BaseModel


class PracticeGenerateRequest(BaseModel):
    problem: str
    count: int = 3


class PracticeProblem(BaseModel):
    question: str
    answer: str


class PracticeGenerateResponse(BaseModel):
    problems: list[PracticeProblem]


class PracticeCheckRequest(BaseModel):
    question: str
    correct_answer: str
    user_answer: str


class PracticeCheckResponse(BaseModel):
    is_correct: bool
