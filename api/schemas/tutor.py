from pydantic import BaseModel


class EvaluateRequest(BaseModel):
    problem: str
    step_before: str
    step_operation: str
    step_after: str
    student_response: str
    session_id: str | None = None


class EvaluateResponse(BaseModel):
    is_correct: bool
    feedback: str


class ExplainRequest(BaseModel):
    step: str
    error: str | None = None
    grade_level: int = 8
    session_id: str | None = None


class ProbeRequest(BaseModel):
    step: str
    student_explanation: str
    session_id: str | None = None


class ProbeResponse(BaseModel):
    understanding: str
    follow_up: str | None
