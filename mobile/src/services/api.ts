import * as SecureStore from "expo-secure-store";

const DEV_HOST = process.env.EXPO_PUBLIC_API_HOST ?? "localhost";
const DEV_PORT = process.env.EXPO_PUBLIC_API_PORT ?? "8000";
const isNgrok = DEV_HOST.endsWith(".ngrok-free.dev");
const API_BASE = __DEV__
  ? isNgrok
    ? `https://${DEV_HOST}/v1`
    : `http://${DEV_HOST}:${DEV_PORT}/v1`
  : "https://math-teacher-api.up.railway.app/v1";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

// Session types
export interface StepDetail {
  title?: string;
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
  subject: string;
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

const USER_NAME_KEY = "user_name";
const USER_ID_KEY = "user_id";

let _authToken: string | null = null;
let _refreshToken: string | null = null;
let _refreshPromise: Promise<boolean> | null = null;
let _onSessionExpired: (() => void) | null = null;
let _userName: string | null = null;
let _userId: string | null = null;
/** Whether the last refresh failure was a definitive auth rejection (401) vs transient error */
let _lastRefreshWasAuthRejection = false;

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

export async function saveUserName(name: string) {
  _userName = name;
  await SecureStore.setItemAsync(USER_NAME_KEY, name);
}

export function getUserName(): string | null {
  return _userName;
}

export async function saveUserId(id: string) {
  _userId = id;
  await SecureStore.setItemAsync(USER_ID_KEY, id);
}

export function getUserId(): string | null {
  return _userId;
}

/**
 * Fetch current user info from /auth/me and store the user ID.
 * Useful after login/register when we only have tokens but no user ID yet.
 */
export async function fetchAndStoreUserId(): Promise<string | null> {
  try {
    const data = await apiGet<{ id: string; name?: string }>("/auth/me");
    if (data.id) await saveUserId(data.id);
    if (data.name) await saveUserName(data.name);
    return data.id ?? null;
  } catch {
    return null;
  }
}

export async function loadStoredAuth(): Promise<boolean> {
  const [access, refresh, storedName, storedId] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.getItemAsync(USER_NAME_KEY),
    SecureStore.getItemAsync(USER_ID_KEY),
  ]);
  if (!access || !refresh) return false;
  _authToken = access;
  _refreshToken = refresh;
  _userName = storedName;
  _userId = storedId;
  // Verify the access token is still valid
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.name) await saveUserName(data.name);
      if (data.id) await saveUserId(data.id);
      return true;
    }
    if (resp.status === 401) return await _tryRefresh();
    // Server error (5xx) — trust cached tokens rather than logging user out
    if (resp.status >= 500) return true;
    return false;
  } catch {
    // Network error / timeout — trust cached tokens rather than logging user out
    return true;
  }
}

export async function clearAuth() {
  _authToken = null;
  _refreshToken = null;
  _userName = null;
  _userId = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_NAME_KEY),
    SecureStore.deleteItemAsync(USER_ID_KEY),
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
    if (resp.status === 401) {
      // Definitive rejection — token is revoked or invalid
      _lastRefreshWasAuthRejection = true;
      return false;
    }
    if (!resp.ok) {
      // Server error — don't treat as auth failure, token may still be valid
      _lastRefreshWasAuthRejection = false;
      return false;
    }
    _lastRefreshWasAuthRejection = false;
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
  if (!data) return `Request failed (${status})`;
  // Handle entitlement error format: { error: "entitlement_required", message: "..." }
  if (data.error === "entitlement_required" && typeof data.message === "string") {
    return data.message;
  }
  if (!data.detail) return `Request failed (${status})`;
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
    } else if (_lastRefreshWasAuthRejection) {
      // Only clear auth on definitive 401 from refresh endpoint.
      // Network errors / 5xx leave tokens intact so a later retry can succeed.
      await clearAuth();
      _onSessionExpired?.();
    }
  }
  return resp;
}

export class EntitlementError extends Error {
  public entitlement: string;
  constructor(message: string, entitlement: string) {
    super(message);
    this.name = "EntitlementError";
    this.entitlement = entitlement;
  }
}

async function apiPost<T>(path: string, body: object, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const resp = await _fetchWithRefresh(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    if (resp.status === 403 && data?.error === "entitlement_required") {
      throw new EntitlementError(
        typeof data.message === "string" ? data.message : "Feature requires Pro subscription",
        typeof data.entitlement === "string" ? data.entitlement : "",
      );
    }
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

async function apiDelete(path: string, body: object): Promise<void> {
  const resp = await _fetchWithRefresh(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    throw new Error(extractError(data, resp.status));
  }
}

// Session API — LLM-backed endpoints use longer timeout
export const createSession = (
  problem: string, mode: string = "learn", subject: string = "math", imageBase64?: string,
) =>
  apiPost<SessionData>(
    "/session",
    { problem, mode, subject, ...(imageBase64 && { image_base64: imageBase64 }) },
    LLM_TIMEOUT_MS,
  );

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
  }, LLM_TIMEOUT_MS);

// Session history
export interface SessionHistoryItem {
  id: string;
  problem: string;
  status: string;
  current_step: number;
  total_steps: number;
  created_at: string;
}

export interface SessionHistoryResponse {
  items: SessionHistoryItem[];
  has_more: boolean;
}

export const getSessionHistory = (subject: string, limit = 20, offset = 0) =>
  apiGet<SessionHistoryResponse>(`/session/history?subject=${subject}&limit=${limit}&offset=${offset}`);

export const createMockTestSession = (problem: string, allProblems?: string[]) =>
  apiPost<{ id: string }>("/session/mock-test", { problem, all_problems: allProblems ?? [] });

export const completeMockTestSession = (id: string, totalQuestions: number, correctCount: number) =>
  apiPost<{ status: string }>(`/session/mock-test/${id}/complete`, {
    total_questions: totalQuestions,
    correct_count: correctCount,
  });

export const createPracticeBatchSession = (problem: string) =>
  apiPost<{ id: string }>("/session/practice-batch", { problem });

export const completePracticeBatchSession = (id: string, totalQuestions: number, correctCount: number) =>
  apiPost<{ status: string }>(`/session/practice-batch/${id}/complete`, {
    total_questions: totalQuestions,
    correct_count: correctCount,
  });

// Auth API
export const login = (email: string, password: string) =>
  apiPost<{ access_token: string; refresh_token: string }>("/auth/login", { email, password });

export const checkEmail = (email: string) =>
  apiPost<{ available: boolean }>("/auth/check-email", { email });

export const register = (email: string, password: string, name: string, gradeLevel: number) =>
  apiPost<{ access_token: string; refresh_token: string }>("/auth/register", {
    email,
    password,
    name,
    grade_level: gradeLevel,
  });

export const forgotPassword = (email: string) =>
  apiPost<{ status: string; message: string }>("/auth/forgot-password", { email });

export const deleteAccount = (password: string) =>
  apiDelete("/auth/account", { password });

// Entitlements
export interface EntitlementLimits {
  daily_sessions_used: number;
  daily_sessions_limit: number | null;
  daily_scans_used: number;
  daily_scans_limit: number | null;
  daily_chats_used: number;
  daily_chats_limit: number | null;
  history_limit: number | null;
}

export interface EntitlementsData {
  is_pro: boolean;
  subscription_tier: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  limits: EntitlementLimits;
  gated_features: string[];
}

export const getEntitlements = () =>
  apiGet<EntitlementsData>("/auth/entitlements");

// Promo API
export const redeemPromoCode = (code: string) =>
  apiPost<{ status: string; message: string; expires_at: string | null }>("/promo/redeem", { code });

// Practice API
export interface PracticeProblem {
  question: string;
  answer: string;
  distractors?: string[];
}

export const generatePracticeProblems = (problem: string, count: number, subject: string = "math") =>
  apiPost<{ problems: PracticeProblem[] }>("/practice/generate", { problem, count, subject }, LLM_TIMEOUT_MS);

export const checkPracticeAnswer = (question: string, correctAnswer: string, userAnswer: string, subject: string = "math") =>
  apiPost<{ is_correct: boolean }>("/practice/check", {
    question,
    correct_answer: correctAnswer,
    user_answer: userAnswer,
    subject,
  }, LLM_TIMEOUT_MS);

// Image API — vision calls can be slow
export const extractProblemsFromImage = (imageBase64: string, subject: string = "math") =>
  apiPost<{ problems: string[]; confidence: string }>("/image/extract", {
    image_base64: imageBase64,
    subject,
  }, LLM_TIMEOUT_MS);

export const extractObjectivesFromImage = (imageBase64: string, subject: string = "math") =>
  apiPost<{ topics: string[]; confidence: string }>("/image/extract-objectives", {
    image_base64: imageBase64,
    subject,
  }, LLM_TIMEOUT_MS);

export type ObjectivesLevel = "middle" | "hs" | "college" | "other";

export interface GenerateFromObjectivesArgs {
  topics: string[];
  count: number;
  level?: ObjectivesLevel;
  courseName?: string;
  subject?: string;
}

export const generateProblemsFromObjectives = (args: GenerateFromObjectivesArgs) =>
  apiPost<{ problems: PracticeProblem[] }>(
    "/practice/generate-from-objectives",
    {
      topics: args.topics,
      count: args.count,
      level: args.level ?? null,
      course_name: args.courseName ?? null,
      subject: args.subject ?? "math",
    },
    LLM_TIMEOUT_MS,
  );

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
  subject: string = "math",
) =>
  apiPost<SubmitWorkResponse>("/work/submit", {
    image_base64: imageBase64,
    problem_text: problemText,
    user_answer: userAnswer,
    user_was_correct: userWasCorrect,
    subject,
  }, LLM_TIMEOUT_MS);

