import * as SecureStore from "expo-secure-store";

const DEV_HOST = process.env.EXPO_PUBLIC_API_HOST ?? "localhost";
const API_BASE = __DEV__
  ? `http://${DEV_HOST}:8000/v1`
  : "https://math-teacher-api.up.railway.app/v1";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

// Session types
export interface StepDetail {
  description: string;
  operation: string;
  before: string;
  after: string;
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
  step_tracking: Record<string, { attempts: number; hints_used: number }>;
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
let _refreshToken: string | null = null;
let _refreshPromise: Promise<boolean> | null = null;
let _onSessionExpired: (() => void) | null = null;

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
    const resp = await fetch(`${API_BASE}/auth/me`, {
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
    const resp = await fetch(`${API_BASE}/auth/refresh`, {
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

async function _fetchWithRefresh(url: string, init: RequestInit): Promise<Response> {
  let resp = await fetch(url, init);
  if (resp.status === 401 && _refreshToken) {
    const refreshed = await _tryRefresh();
    if (refreshed) {
      // Retry with new token
      const newInit = { ...init, headers: authHeaders() };
      resp = await fetch(url, newInit);
    } else {
      await clearAuth();
      _onSessionExpired?.();
    }
  }
  return resp;
}

async function apiPost<T>(path: string, body: object): Promise<T> {
  const resp = await _fetchWithRefresh(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
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

export const getSimilarProblem = (sessionId: string) =>
  apiPost<{ similar_problem: string }>(`/session/${sessionId}/similar`, {});

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
  apiPost<{ problems: PracticeProblem[] }>("/practice/generate", { problem, count });

export const checkPracticeAnswer = (question: string, correctAnswer: string, userAnswer: string) =>
  apiPost<{ is_correct: boolean }>("/practice/check", {
    question,
    correct_answer: correctAnswer,
    user_answer: userAnswer,
  });

