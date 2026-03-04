import pytest

from api.core.math_engine import MathEngine, ParseError


class TestParsing:
    def test_parse_simple_expression(self) -> None:
        result = MathEngine.parse("2*x + 3")
        assert str(result) == "2*x + 3"

    def test_parse_equation(self) -> None:
        result = MathEngine.parse("2*x + 6 = 12")
        assert result.lhs is not None
        assert result.rhs is not None

    def test_parse_implicit_multiplication(self) -> None:
        result = MathEngine.parse("2x + 3")
        assert str(result) == "2*x + 3"

    def test_parse_quadratic(self) -> None:
        result = MathEngine.parse("x^2 + 5*x + 6 = 0")
        assert result is not None

    def test_parse_invalid_raises(self) -> None:
        with pytest.raises(ParseError):
            MathEngine.parse("///invalid///")


class TestSolving:
    def test_solve_linear(self) -> None:
        solutions = MathEngine.solve_problem("2*x + 6 = 12")
        assert len(solutions) == 1
        assert solutions[0] == 3

    def test_solve_quadratic(self) -> None:
        solutions = MathEngine.solve_problem("x^2 + 5*x + 6 = 0")
        assert set(solutions) == {-2, -3}

    def test_solve_identity(self) -> None:
        # x = x is always true
        solutions = MathEngine.solve_problem("x = x")
        # SymPy returns empty for identities (all x are solutions)
        # or may raise; this documents behavior
        assert solutions is not None

    def test_simplify_expression(self) -> None:
        solutions = MathEngine.solve_problem("2*x + 3*x")
        assert solutions[0] == MathEngine.parse("5*x")


class TestVerification:
    def test_correct_answer(self) -> None:
        assert MathEngine.verify_answer("2*x + 6 = 12", "3") is True

    def test_wrong_answer(self) -> None:
        assert MathEngine.verify_answer("2*x + 6 = 12", "5") is False

    def test_quadratic_answer(self) -> None:
        assert MathEngine.verify_answer("x^2 + 5*x + 6 = 0", "-2") is True
        assert MathEngine.verify_answer("x^2 + 5*x + 6 = 0", "-3") is True

    def test_wrong_quadratic_answer(self) -> None:
        assert MathEngine.verify_answer("x^2 + 5*x + 6 = 0", "2") is False


class TestEquivalence:
    def test_fraction_equivalence(self) -> None:
        assert MathEngine.are_equivalent("2/4", "1/2") is True

    def test_commutative(self) -> None:
        assert MathEngine.are_equivalent("x + 1", "1 + x") is True

    def test_expanded_vs_factored(self) -> None:
        assert MathEngine.are_equivalent("x^2 + 2*x + 1", "(x+1)^2") is True

    def test_not_equivalent(self) -> None:
        assert MathEngine.are_equivalent("x + 1", "x + 2") is False

    def test_division_equivalence(self) -> None:
        assert MathEngine.are_equivalent("6/3", "2") is True


class TestSimilarProblem:
    def test_similar_linear(self) -> None:
        similar = MathEngine.generate_similar("2*x + 6 = 12")
        assert similar != ""
        # Should be parseable
        MathEngine.parse(similar)

    def test_similar_quadratic(self) -> None:
        similar = MathEngine.generate_similar("x^2 + 5*x + 6 = 0")
        assert similar != ""
        MathEngine.parse(similar)


class TestClassification:
    def test_linear(self) -> None:
        assert MathEngine.classify_problem("2*x + 6 = 12") == "linear"

    def test_quadratic(self) -> None:
        assert MathEngine.classify_problem("x^2 + 5*x + 6 = 0") == "quadratic"

    def test_arithmetic(self) -> None:
        assert MathEngine.classify_problem("2 + 3") == "arithmetic"


class TestArithmetic:
    def test_evaluate_addition(self) -> None:
        result = MathEngine.evaluate_arithmetic("2 + 3")
        assert result == 5

    def test_evaluate_fraction(self) -> None:
        result = MathEngine.evaluate_arithmetic("1/3 + 1/6")
        assert result == MathEngine.parse("1/2")

    def test_evaluate_large_numbers(self) -> None:
        result = MathEngine.evaluate_arithmetic("999999 * 999999")
        assert result == 999998000001
