import pytest
from httpx import AsyncClient


@pytest.mark.anyio
async def test_parse_linear_equation(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": "2x + 6 = 12"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["problem_type"] == "linear"
    assert "3" in data["solutions"]
    assert data["latex"]
    assert data["solutions_latex"]


@pytest.mark.anyio
async def test_parse_quadratic_equation(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": "x^2 - 5x + 6 = 0"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["problem_type"] == "quadratic"
    assert set(data["solutions"]) == {"2", "3"}


@pytest.mark.anyio
async def test_parse_arithmetic(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": "3 + 4 * 2"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["problem_type"] == "arithmetic"
    assert "11" in data["solutions"]


@pytest.mark.anyio
async def test_parse_expression(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": "x^2 + 2x + 1"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["expression"]
    assert data["latex"]


@pytest.mark.anyio
async def test_parse_invalid_input(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": "@@!!"})
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_parse_empty_string(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": ""})
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_parse_too_long(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": "x + " * 100})
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_latex_fields_present(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": "x^2 = 9"})
    assert resp.status_code == 200
    data = resp.json()
    assert "x^{2} = 9" in data["latex"] or "x^2" in data["latex"]
    assert len(data["solutions_latex"]) == len(data["solutions"])


@pytest.mark.anyio
async def test_implicit_multiplication(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": "2x + 3 = 7"})
    assert resp.status_code == 200
    data = resp.json()
    assert "2" in data["solutions"]


@pytest.mark.anyio
async def test_fractions(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": "x/2 + 1 = 3"})
    assert resp.status_code == 200
    data = resp.json()
    assert "4" in data["solutions"]


@pytest.mark.anyio
async def test_exponents(client: AsyncClient) -> None:
    resp = await client.post("/v1/problems/parse", json={"expression": "x^3 = 8"})
    assert resp.status_code == 200
    data = resp.json()
    assert "2" in data["solutions"]
