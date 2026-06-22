import * as SecureStore from "expo-secure-store";

const DEV_HOST = process.env.EXPO_PUBLIC_API_HOST ?? "localhost";
const DEV_PORT = process.env.EXPO_PUBLIC_API_PORT ?? "8000";
// Any known public tunnel host -> HTTPS without port. Direct LAN/localhost
// dev keeps http+port. Add new tunnel suffixes here as we adopt them.
const isNgrok = DEV_HOST.endsWith(".ngrok-free.dev");
const isCloudflareTunnel = DEV_HOST.endsWith(".trycloudflare.com");
const isTunnel = isNgrok || isCloudflareTunnel;
const API_BASE = __DEV__
  ? isTunnel
    ? `https://${DEV_HOST}/v1`
    : `http://${DEV_HOST}:${DEV_PORT}/v1`
  : "https://mathteacherapp-production.up.railway.app/v1";

// One-time diagnostic on bundle load. If Metro served a stale bundle
// (i.e. expo started without --clear after .env changed), this will
// print a host that doesn't match mobile/.env — that's the smoking gun.
if (__DEV__) console.warn(`[api] API_BASE = ${API_BASE}`);

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
const USER_ROLE_KEY = "user_role";
const USER_SCHOOL_KEY = "user_school_id";

let _authToken: string | null = null;
let _refreshToken: string | null = null;
let _refreshPromise: Promise<boolean> | null = null;
let _onSessionExpired: (() => void) | null = null;
let _userName: string | null = null;
let _userId: string | null = null;
let _userRole: string | null = null;
let _userSchoolId: string | null = null;
/** Whether the last refresh failure was a definitive auth rejection (401) vs transient error */
let _lastRefreshWasAuthRejection = false;

// When the dev backend is fronted by ngrok-free, every request without
// this header gets the HTML "ERR_NGROK_6024 — you are about to visit"
// interstitial instead of the real API response. The fetch then either
// throws "Network request failed" trying to parse HTML as JSON or
// silently fails downstream. Setting the header on every request via
// the central wrapper makes the interstitial vanish.
function withNgrokBypass(headers: HeadersInit | undefined): HeadersInit | undefined {
  if (!isNgrok) return headers;
  return { ...(headers ?? {}), "ngrok-skip-browser-warning": "1" };
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...init,
    headers: withNgrokBypass(init.headers),
    signal: controller.signal,
  }).finally(() => clearTimeout(id));
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

/** Account role ("student" | "teacher" | "admin"). Null until /auth/me resolves. */
export function getUserRole(): string | null {
  return _userRole;
}

/** School the user belongs to, or null for personal learners. */
export function getUserSchoolId(): string | null {
  return _userSchoolId;
}

export interface Me {
  id: string;
  name?: string;
  role: string;
  school_id: string | null;
  school_name?: string | null;
}

/** Cache + persist the identity fields we route on (id, name, role, school). */
async function cacheMe(data: Me): Promise<void> {
  _userRole = data.role ?? null;
  _userSchoolId = data.school_id ?? null;
  await Promise.all([
    data.id ? saveUserId(data.id) : Promise.resolve(),
    data.name ? saveUserName(data.name) : Promise.resolve(),
    SecureStore.setItemAsync(USER_ROLE_KEY, _userRole ?? ""),
    SecureStore.setItemAsync(USER_SCHOOL_KEY, _userSchoolId ?? ""),
  ]);
}

/**
 * Fetch the current user from /auth/me and cache the fields the app
 * routes on (id, name, role, school_id). Returns null on failure.
 */
export async function fetchMe(): Promise<Me | null> {
  try {
    const data = await apiGet<Me>("/auth/me");
    await cacheMe(data);
    return data;
  } catch {
    return null;
  }
}

export async function loadStoredAuth(): Promise<boolean> {
  const [access, refresh, storedName, storedId, storedRole, storedSchool] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.getItemAsync(USER_NAME_KEY),
    SecureStore.getItemAsync(USER_ID_KEY),
    SecureStore.getItemAsync(USER_ROLE_KEY),
    SecureStore.getItemAsync(USER_SCHOOL_KEY),
  ]);
  if (!access || !refresh) return false;
  _authToken = access;
  _refreshToken = refresh;
  _userName = storedName;
  _userId = storedId;
  // Seed role/school from cache so offline cold-starts can still route
  // correctly; the /auth/me below refreshes them when the network is up.
  _userRole = storedRole || null;
  _userSchoolId = storedSchool || null;
  // Verify the access token is still valid
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (resp.ok) {
      await cacheMe(await resp.json());
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
  _userRole = null;
  _userSchoolId = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_NAME_KEY),
    SecureStore.deleteItemAsync(USER_ID_KEY),
    SecureStore.deleteItemAsync(USER_ROLE_KEY),
    SecureStore.deleteItemAsync(USER_SCHOOL_KEY),
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

// Weak spots — recent problems where the student's submitted work was
// flagged by diagnosis. Powers the Review tab.
export interface WeakSpotItem {
  problem_text: string;
  summary: string;
  submitted_at: string;
  session_id: string | null;
  issue_count: number;
}

export interface WeakSpotsResponse {
  items: WeakSpotItem[];
}

export const getWeakSpots = (subject: string, limit = 20) =>
  apiGet<WeakSpotsResponse>(`/weak-spots?subject=${subject}&limit=${limit}`);

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
// A login either grants tokens or — for MFA-enabled (teacher/admin)
// accounts — returns an `mfa_pending_token` with no access token. Mobile
// has no MFA code-entry flow, so the caller treats a token-less response
// as "a teacher signed in" and routes to the web-app gate.
export const login = (email: string, password: string) =>
  apiPost<{ access_token?: string; refresh_token?: string; mfa_pending_token?: string }>(
    "/auth/login",
    { email, password },
  );

export const checkEmail = (email: string) =>
  apiPost<{ available: boolean }>("/auth/check-email", { email });

export const register = (
  email: string,
  password: string,
  name: string,
  gradeLevel: number,
  joinCode?: string,
) =>
  apiPost<{ access_token: string; refresh_token: string }>("/auth/register", {
    email,
    password,
    name,
    grade_level: gradeLevel,
    // Only sent when the student entered a class code. The backend then
    // enrolls them in that section and stamps school_id (and the code
    // satisfies the COPPA school-consent exception for under-13s).
    ...(joinCode ? { join_code: joinCode } : {}),
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

// Practice API
export interface PracticeProblem {
  question: string;
  answer: string;
  distractors?: string[];
}

/**
 * Call /practice/generate with one of two shapes:
 *   - `problem: string` + `count > 0`  → backend generates `count` similar problems from this source
 *   - `problem: string` + `count === 0` → backend solves the problem (returns answer + distractors)
 *   - `problems: string[]` + `count > 0` → backend round-robins across sources, returns `count` total
 *   - `problems: string[]` + `count === 0` → backend returns one similar per source (length-preserving)
 */
export const generatePracticeProblems = (
  problem: string | string[],
  count: number,
  subject: string = "math",
) => {
  const body = Array.isArray(problem)
    ? { problems: problem, count, subject }
    : { problem, count, subject };
  return apiPost<{ problems: PracticeProblem[] }>("/practice/generate", body, LLM_TIMEOUT_MS);
};

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

