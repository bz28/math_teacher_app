from pydantic import BaseModel, field_validator


class ProblemParseRequest(BaseModel):
    expression: str

    @field_validator("expression")
    @classmethod
    def validate_expression(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Expression cannot be empty")
        if len(v) > 200:
            raise ValueError("Expression too long (max 200 characters)")
        return v


class ProblemParseResponse(BaseModel):
    expression: str
    latex: str
    problem_type: str
    solutions: list[str]
    solutions_latex: list[str]
