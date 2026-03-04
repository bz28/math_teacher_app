const API_BASE = __DEV__
  ? "http://localhost:8000/v1"
  : "https://math-teacher-api.up.railway.app/v1";

export interface ParsedProblem {
  expression: string;
  latex: string;
  problem_type: string;
  solutions: string[];
  solutions_latex: string[];
}

export async function parseProblem(expression: string): Promise<ParsedProblem> {
  const resp = await fetch(`${API_BASE}/problems/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expression }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    const detail = body?.detail ?? `Request failed (${resp.status})`;
    throw new Error(detail);
  }

  return resp.json();
}
