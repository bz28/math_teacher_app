"""Math engine: SymPy-based parsing, verification, equivalence, and problem generation."""

import random
import re

from sympy import (
    Eq,
    Expr,
    Rational,
    Symbol,
    expand,
    simplify,
    solve,
    sympify,
)
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)

x = Symbol("x")


class ParseError(Exception):
    pass


class MathEngine:
    @staticmethod
    def parse(expression: str) -> Expr | Eq:
        """Parse a string into a SymPy expression or equation."""
        try:
            expr_str = expression.strip()
            if "=" in expr_str:
                left, right = expr_str.split("=", 1)
                lhs = parse_expr(left.strip(), transformations=TRANSFORMATIONS)
                rhs = parse_expr(right.strip(), transformations=TRANSFORMATIONS)
                return Eq(lhs, rhs)
            return parse_expr(expr_str, transformations=TRANSFORMATIONS)
        except Exception as e:
            raise ParseError(f"Cannot parse: {expression}") from e

    @staticmethod
    def solve_problem(expression: str) -> list[Expr]:
        """Solve an equation or simplify an expression. Returns list of solutions."""
        parsed = MathEngine.parse(expression)
        if isinstance(parsed, Eq):
            solutions = solve(parsed, x)
            return [sympify(s) for s in solutions]
        # For expressions, simplify
        return [simplify(parsed)]

    @staticmethod
    def verify_answer(problem: str, proposed_answer: str) -> bool:
        """Check if a proposed answer is correct for the given problem."""
        try:
            correct_solutions = MathEngine.solve_problem(problem)
            proposed = MathEngine.parse(proposed_answer)

            # Check if proposed matches any correct solution
            for solution in correct_solutions:
                if MathEngine.are_equivalent(proposed, solution):
                    return True
            return False
        except (ParseError, Exception):
            return False

    @staticmethod
    def _strip_variable_assignment(text: str) -> str:
        """Strip leading variable assignment like 'x = ', 'k = ' from a string."""
        import re

        # Match patterns like "x = 3", "k = -2", "y = 1/2"
        m = re.match(r"^[a-zA-Z_]\w*\s*=\s*(.+)$", text.strip())
        return m.group(1).strip() if m else text.strip()

    @staticmethod
    def are_equivalent(expr1: Expr | str, expr2: Expr | str) -> bool:
        """Check if two expressions are mathematically equivalent.

        Handles cases like "x = 3" vs "3" by stripping variable assignments.
        """
        try:
            # Strip variable assignments from strings before parsing
            if isinstance(expr1, str):
                expr1 = MathEngine._strip_variable_assignment(expr1)
            if isinstance(expr2, str):
                expr2 = MathEngine._strip_variable_assignment(expr2)

            parsed1 = MathEngine.parse(expr1) if isinstance(expr1, str) else expr1
            parsed2 = MathEngine.parse(expr2) if isinstance(expr2, str) else expr2

            diff = simplify(parsed1 - parsed2)
            return bool(diff == 0)
        except Exception:
            return False

    @staticmethod
    def generate_similar(problem: str) -> str:
        """Generate a similar problem with different numbers but same structure."""
        try:
            parsed = MathEngine.parse(problem)

            if isinstance(parsed, Eq):
                # For equations: solve, pick new random coefficients
                return MathEngine._generate_similar_equation(parsed)
            # For expressions: vary the coefficients
            return MathEngine._generate_similar_expression(parsed)
        except Exception:
            return problem  # Fallback: return original

    @staticmethod
    def _generate_similar_equation(eq: Eq) -> str:
        """Generate a similar equation by varying coefficients."""
        lhs = expand(eq.lhs - eq.rhs)
        # Get the polynomial coefficients
        coeffs = lhs.as_poly(x)
        if coeffs is None:
            # Not a polynomial in x, try simple variation
            return str(eq)

        degree = coeffs.degree()
        if degree == 1:
            # Linear: ax + b = 0 → new random a, b
            a = random.randint(2, 10) * random.choice([-1, 1])
            b = random.randint(1, 20) * random.choice([-1, 1])
            c = random.randint(0, 15) * random.choice([-1, 1])
            return f"{a}*x + {b} = {c}"
        elif degree == 2:
            # Quadratic: pick factors for nice solutions
            r1 = random.randint(-5, 5)
            r2 = random.randint(-5, 5)
            # (x - r1)(x - r2) = x^2 - (r1+r2)x + r1*r2
            expr = expand((x - r1) * (x - r2))
            return f"{expr} = 0"
        return str(eq)

    @staticmethod
    def _generate_similar_expression(expr: Expr) -> str:
        """Generate a similar expression by varying coefficients."""
        expanded = expand(expr)

        # Simple approach: if it's a polynomial, generate with new random coefficients
        poly = expanded.as_poly(x)
        if poly is not None:
            degree = poly.degree()
            new_coeffs = [random.randint(1, 10) * random.choice([-1, 1]) for _ in range(degree + 1)]
            new_expr = sum(c * x**i for i, c in enumerate(new_coeffs))
            return str(expand(new_expr))

        return str(expr)

    @staticmethod
    def is_word_problem(text: str) -> bool:
        """Detect whether text is a math word problem (vs garbage or pure math).

        Returns True only if the text looks like narrative math:
        has digits, >= 4 words, and contains >= 2 math-related keywords.
        """
        # If SymPy can parse it directly, it's already math notation
        try:
            MathEngine.parse(text)
            return False
        except Exception:
            pass

        words = text.split()
        if len(words) < 4:
            return False
        if not re.search(r"\d", text):
            return False

        math_keywords = {
            "how", "many", "much", "total", "sum", "difference", "product",
            "each", "per", "find", "solve", "calculate", "equal", "equals",
            "plus", "minus", "times", "divided", "remaining", "left",
            "more", "less", "twice", "half", "triple", "percent",
            "cost", "price", "speed", "distance", "rate", "time",
            "area", "length", "width", "height", "miles", "hours",
            "meters", "feet", "pounds", "dollars", "gallons", "liters",
        }
        text_lower = text.lower()
        keyword_count = sum(1 for kw in math_keywords if kw in text_lower)
        return keyword_count >= 2

    @staticmethod
    def classify_problem(expression: str) -> str:
        """Classify problem type for few-shot caching."""
        if MathEngine.is_word_problem(expression):
            return "word_problem"
        try:
            parsed = MathEngine.parse(expression)
            if isinstance(parsed, Eq):
                lhs = expand(parsed.lhs - parsed.rhs)
                poly = lhs.as_poly(x)
                if poly is None:
                    return "expression"
                degree = poly.degree()
                if degree == 1:
                    return "linear"
                elif degree == 2:
                    return "quadratic"
                return f"polynomial_degree_{degree}"
            # Classify expression type
            if parsed.is_number:
                return "arithmetic"
            return "algebraic_expression"
        except Exception:
            return "unknown"

    @staticmethod
    def evaluate_arithmetic(expression: str) -> Rational | Expr:
        """Evaluate a pure arithmetic expression."""
        try:
            parsed = MathEngine.parse(expression)
            result = sympify(parsed)
            if result.is_number:
                return Rational(result)
            return result
        except Exception as e:
            raise ParseError(f"Cannot evaluate: {expression}") from e
