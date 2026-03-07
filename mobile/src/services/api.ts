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

// Session types
export interface StepDetail {
  description: string;
  operation: string;
  before: string;
  after: string;
}

export interface SessionData {
  id: string;
  problem: string;
  problem_type: string;
  current_step: number;
  total_steps: number;
  status: string;
  mode: string;
  steps: StepDetail[];
  step_tracking: Record<string, { attempts: number; hints_used: number; explain_back: boolean }>;
}

export interface StepResponse {
  action: string;
  feedback: string;
  current_step: number;
  total_steps: number;
  is_correct: boolean;
  similar_problem: string | null;
  step_description: string | null;
}

let _authToken: string | null = null;
export function setAuthToken(token: string | null) {
  _authToken = token;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_authToken) headers["Authorization"] = `Bearer ${_authToken}`;
  return headers;
}

async function apiPost<T>(path: string, body: object): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    throw new Error(data?.detail ?? `Request failed (${resp.status})`);
  }
  return resp.json();
}

async function apiGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    throw new Error(data?.detail ?? `Request failed (${resp.status})`);
  }
  return resp.json();
}

// Session API
export const createSession = (problem: string, mode: string = "learn") =>
  apiPost<SessionData>("/session", { problem, mode });

export const getSession = (id: string) =>
  apiGet<SessionData>(`/session/${id}`);

export const respondToStep = (
  id: string,
  studentResponse: string,
  requestHint = false,
  requestShowStep = false,
  requestAdvance = false,
) =>
  apiPost<StepResponse>(`/session/${id}/respond`, {
    student_response: studentResponse,
    request_hint: requestHint,
    request_show_step: requestShowStep,
    request_advance: requestAdvance,
  });

export const submitExplainBack = (
  id: string,
  explanation: string,
) =>
  apiPost<StepResponse>(`/session/${id}/explain-back`, {
    student_explanation: explanation,
  });

// Auth API
export const login = (email: string, password: string) =>
  apiPost<{ access_token: string; refresh_token: string }>("/auth/login", { email, password });

export const register = (email: string, password: string, gradeLevel: number) =>
  apiPost<{ access_token: string; refresh_token: string }>("/auth/register", {
    email,
    password,
    grade_level: gradeLevel,
  });

// Practice API
export interface PracticeProblem {
  question: string;
  answer: string;
}

export const generatePracticeProblems = (problem: string, count: number) =>
  apiPost<{ problems: PracticeProblem[] }>("/practice/generate", { problem, count });

export const checkPracticeAnswer = (question: string, correctAnswer: string, userAnswer: string) =>
  apiPost<{ is_correct: boolean }>("/practice/check", {
    question,
    correct_answer: correctAnswer,
    user_answer: userAnswer,
  });

// Problem parsing
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
