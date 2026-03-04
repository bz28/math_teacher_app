from fastapi import APIRouter, HTTPException
from sympy import latex

from api.core.math_engine import MathEngine, ParseError
from api.schemas.problems import ProblemParseRequest, ProblemParseResponse

router = APIRouter()


@router.post("/problems/parse", response_model=ProblemParseResponse)
async def parse_problem(body: ProblemParseRequest) -> ProblemParseResponse:
    """Parse a math expression and return solutions with LaTeX rendering."""
    try:
        parsed = MathEngine.parse(body.expression)
    except ParseError:
        raise HTTPException(status_code=422, detail="Could not parse expression")

    problem_type = MathEngine.classify_problem(body.expression)
    solutions = MathEngine.solve_problem(body.expression)

    return ProblemParseResponse(
        expression=str(parsed),
        latex=latex(parsed),
        problem_type=problem_type,
        solutions=[str(s) for s in solutions],
        solutions_latex=[latex(s) for s in solutions],
    )
