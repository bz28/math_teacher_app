"""Schemas for work submission and diagnosis."""

import uuid

from pydantic import BaseModel, Field


class SubmitWorkRequest(BaseModel):
    image_base64: str = Field(..., max_length=7_000_000)  # ~5MB decoded
    problem_text: str = Field(..., min_length=1, max_length=5000)
    user_answer: str = Field("", max_length=2000)
    user_was_correct: bool = False


class DiagnosisStep(BaseModel):
    step_description: str
    status: str  # "correct" | "error" | "skipped" | "suboptimal" | "unclear"
    student_work: str | None = None
    feedback: str | None = None


class DiagnosisResult(BaseModel):
    steps: list[DiagnosisStep]
    summary: str
    has_issues: bool
    overall_feedback: str


class SubmitWorkResponse(BaseModel):
    id: uuid.UUID
    diagnosis: DiagnosisResult | None = None
