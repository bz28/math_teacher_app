import * as SecureStore from "expo-secure-store";

const DEV_HOST = process.env.EXPO_PUBLIC_API_HOST ?? "localhost";
const isNgrok = DEV_HOST.endsWith(".ngrok-free.dev");
const API_BASE = __DEV__
  ? isNgrok
    ? `https://${DEV_HOST}/v1`
    : `http://${DEV_HOST}:8000/v1`
  : "https://math-teacher-api.up.railway.app/v1";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

// Session types
export interface StepDetail {
  description: string;
  final_answer?: string;
  choices?: string[];
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
}

export interface StepResponse {
  action: string;
  feedback: string;
  current_step: number;
  total_steps: number;
  is_correct: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const LLM_TIMEOUT_MS = 30_000;

let _authToken: string | null = null;
let _refreshToken: string | null = null;
let _refreshPromise: Promise<boolean> | null = null;
let _onSessionExpired: (() => void) | null = null;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

export function setOnSessionExpired(callback: () => void) {
  _onSessionExpired = callback;
}

export async function saveTokens(access: string, refresh: string) {
  _authToken = access;
  _refreshToken = refresh;
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh),
  ]);
}

export async function loadStoredAuth(): Promise<boolean> {
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  if (!access || !refresh) return false;
  _authToken = access;
  _refreshToken = refresh;
  // Verify the access token is still valid
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (resp.ok) return true;
    if (resp.status === 401) return await _tryRefresh();
    return false;
  } catch {
    return false;
  }
}

export async function clearAuth() {
  _authToken = null;
  _refreshToken = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

async function _tryRefresh(): Promise<boolean> {
  if (!_refreshToken) return false;
  // Deduplicate concurrent refresh attempts
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = _doRefresh();
  try {
    return await _refreshPromise;
  } finally {
    _refreshPromise = null;
  }
}

async function _doRefresh(): Promise<boolean> {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: _refreshToken }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    await saveTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_authToken) headers["Authorization"] = `Bearer ${_authToken}`;
  return headers;
}

function extractError(data: Record<string, unknown> | null, status: number): string {
  if (!data?.detail) return `Request failed (${status})`;
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) {
    return data.detail.map((e: { msg?: string }) => e.msg ?? String(e)).join(". ");
  }
  return `Request failed (${status})`;
}

async function _fetchWithRefresh(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  let resp = await fetchWithTimeout(url, init, timeoutMs);
  if (resp.status === 401 && _refreshToken) {
    const refreshed = await _tryRefresh();
    if (refreshed) {
      // Retry with new token
      const newInit = { ...init, headers: authHeaders() };
      resp = await fetchWithTimeout(url, newInit, timeoutMs);
    } else {
      await clearAuth();
      _onSessionExpired?.();
    }
  }
  return resp;
}

async function apiPost<T>(path: string, body: object, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const resp = await _fetchWithRefresh(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    throw new Error(extractError(data, resp.status));
  }
  return resp.json();
}

async function apiGet<T>(path: string): Promise<T> {
  const resp = await _fetchWithRefresh(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    throw new Error(extractError(data, resp.status));
  }
  return resp.json();
}

// Session API — LLM-backed endpoints use longer timeout
export const createSession = (problem: string, mode: string = "learn") =>
  apiPost<SessionData>("/session", { problem, mode }, LLM_TIMEOUT_MS);

export const getSession = (id: string) =>
  apiGet<SessionData>(`/session/${id}`);

export const respondToStep = (
  id: string,
  studentResponse: string,
  requestAdvance = false,
) =>
  apiPost<StepResponse>(`/session/${id}/respond`, {
    student_response: studentResponse,
    request_advance: requestAdvance,
  });

export const getSimilarProblem = (sessionId: string) =>
  apiPost<{ similar_problem: string }>(`/session/${sessionId}/similar`, {});

export const createMockTestSession = (problem: string) =>
  apiPost<{ id: string }>("/session/mock-test", { problem });

export const completeMockTestSession = (id: string, totalQuestions: number, correctCount: number) =>
  apiPost<{ status: string }>(`/session/mock-test/${id}/complete`, {
    total_questions: totalQuestions,
    correct_count: correctCount,
  });

// Auth API
export const login = (email: string, password: string) =>
  apiPost<{ access_token: string; refresh_token: string }>("/auth/login", { email, password });

export const checkEmail = (email: string) =>
  apiPost<{ available: boolean }>("/auth/check-email", { email });

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
  apiPost<{ problems: PracticeProblem[] }>("/practice/generate", { problem, count }, LLM_TIMEOUT_MS);

export const checkPracticeAnswer = (question: string, correctAnswer: string, userAnswer: string) =>
  apiPost<{ is_correct: boolean }>("/practice/check", {
    question,
    correct_answer: correctAnswer,
    user_answer: userAnswer,
  });

// Image API — vision calls can be slow
export const extractProblemsFromImage = (imageBase64: string) =>
  apiPost<{ problems: string[]; confidence: string }>("/image/extract", {
    image_base64: imageBase64,
  }, LLM_TIMEOUT_MS);

// Work submission API
export interface WorkDiagnosisStep {
  step_description: string;
  status: "correct" | "error" | "skipped" | "suboptimal" | "unclear";
  student_work: string | null;
  feedback: string | null;
}

export interface WorkDiagnosis {
  steps: WorkDiagnosisStep[];
  summary: string;
  has_issues: boolean;
  overall_feedback: string;
}

export interface SubmitWorkResponse {
  id: string;
  diagnosis: WorkDiagnosis | null;
}

export const submitWork = (
  imageBase64: string,
  problemText: string,
  userAnswer: string,
  userWasCorrect: boolean,
) =>
  apiPost<SubmitWorkResponse>("/work/submit", {
    image_base64: imageBase64,
    problem_text: problemText,
    user_answer: userAnswer,
    user_was_correct: userWasCorrect,
  }, LLM_TIMEOUT_MS);

