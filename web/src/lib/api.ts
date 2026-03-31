/**
 * API client for the FastAPI backend.
 * Mirrors mobile/src/services/api.ts — same endpoints, same auth flow.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/v1";
const DEFAULT_TIMEOUT = 15_000;
const LLM_TIMEOUT = 30_000;

// ── Types ──

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  grade_level: number;
  role: string;
  subscription_tier: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  is_pro: boolean;
}

export interface StepDetail {
  title?: string;
  description: string;
  final_answer: string | null;
  choices: string[] | null;
}

export interface SessionResponse {
  id: string;
  problem: string;
  problem_type: string;
  current_step: number;
  total_steps: number;
  status: "active" | "completed" | "abandoned";
  mode: string;
  subject: string;
  steps: StepDetail[];
}

export interface StepResponse {
  action: "completed" | "evaluate_response" | "show_step";
  feedback: string;
  current_step: number;
  total_steps: number;
  is_correct: boolean;
}

export interface PracticeProblem {
  question: string;
  answer: string;
  distractors?: string[];
}

export interface PracticeGenerateResponse {
  problems: PracticeProblem[];
}

export interface PracticeCheckResponse {
  is_correct: boolean;
}

export interface ImageExtractResponse {
  problems: string[];
  confidence: "high" | "medium" | "low";
}

export interface DiagnosisStep {
  step_description: string;
  status: "correct" | "error" | "skipped" | "suboptimal" | "unclear";
  student_work: string | null;
  feedback: string | null;
}

export interface DiagnosisResult {
  steps: DiagnosisStep[];
  summary: string;
  has_issues: boolean;
  overall_feedback: string;
}

export interface WorkSubmitResponse {
  id: string;
  diagnosis: DiagnosisResult | null;
}

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

// ── Error ──

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super((body?.detail as string) ?? `API error ${status}`);
    this.name = "ApiError";
  }
}

export class EntitlementError extends ApiError {
  public entitlement: string;
  public isLimit: boolean;

  constructor(status: number, body: Record<string, unknown>) {
    super(status, body);
    this.name = "EntitlementError";
    this.entitlement = (body.entitlement as string) ?? "";
    this.isLimit = (body.is_limit as boolean) ?? false;
    this.message = (body.message as string) ?? "Feature requires Pro subscription";
  }
}

// ── Token storage ──

const TOKEN_KEY = "veradic_access_token";
const REFRESH_KEY = "veradic_refresh_token";

function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function saveTokens(tokens: TokenPair) {
  localStorage.setItem(TOKEN_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function hasStoredTokens(): boolean {
  return !!getAccessToken() && !!getRefreshToken();
}

// ── Refresh deduplication ──

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const rt = getRefreshToken();
    if (!rt) return false;
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) return false;
      const data: TokenPair = await res.json();
      saveTokens(data);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ── Core fetch ──

async function apiFetch<T>(
  path: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOpts } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(fetchOpts.headers as Record<string, string> | undefined),
  };

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...fetchOpts,
      headers,
      signal: controller.signal,
    });

    if (res.status === 401) {
      // Don't attempt token refresh for auth endpoints — their 401s
      // mean invalid credentials, not expired sessions
      const isAuthEndpoint = path.startsWith("/auth/");
      if (!isAuthEndpoint) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          clearTimeout(timer);
          return apiFetch(path, options);
        }
        clearTokens();
      }
      const body = await res.json().catch(() => ({}));
      throw new ApiError(401, body);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && body.error === "entitlement_required") {
        throw new EntitlementError(res.status, body);
      }
      throw new ApiError(res.status, body);
    }

    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Auth endpoints ──

export const auth = {
  checkEmail(email: string) {
    return apiFetch<{ available: boolean }>("/auth/check-email", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  register(data: {
    email: string;
    password: string;
    name: string;
    grade_level: number;
  }) {
    return apiFetch<TokenPair>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  login(email: string, password: string) {
    return apiFetch<TokenPair>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  me() {
    return apiFetch<User>("/auth/me");
  },
};

// ── Session endpoints ──

export const session = {
  create(data: {
    problem: string;
    mode: "learn" | "practice";
    subject: string;
    image_base64?: string;
  }) {
    return apiFetch<SessionResponse>("/session", {
      method: "POST",
      body: JSON.stringify(data),
      timeout: LLM_TIMEOUT,
    });
  },

  get(sessionId: string) {
    return apiFetch<SessionResponse>(`/session/${sessionId}`);
  },

  respond(
    sessionId: string,
    data: { student_response: string; request_advance: boolean },
  ) {
    return apiFetch<StepResponse>(`/session/${sessionId}/respond`, {
      method: "POST",
      body: JSON.stringify(data),
      timeout: LLM_TIMEOUT,
    });
  },

  similar(sessionId: string) {
    return apiFetch<{ similar_problem: string }>(
      `/session/${sessionId}/similar`,
      {
        method: "POST",
        timeout: LLM_TIMEOUT,
      },
    );
  },

  history(subject: string, limit = 20, offset = 0) {
    const params = new URLSearchParams({
      subject,
      limit: String(limit),
      offset: String(offset),
    });
    return apiFetch<SessionHistoryResponse>(`/session/history?${params}`);
  },

  abandon(sessionId: string) {
    return apiFetch<{ status: string }>(`/session/${sessionId}/abandon`, {
      method: "POST",
    });
  },

  createMockTest(problem: string) {
    return apiFetch<{ id: string }>("/session/mock-test", {
      method: "POST",
      body: JSON.stringify({ problem }),
    });
  },

  completeMockTest(
    sessionId: string,
    data: { total_questions: number; correct_count: number },
  ) {
    return apiFetch<{ status: string }>(
      `/session/mock-test/${sessionId}/complete`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  },

  createPracticeBatch(problem: string) {
    return apiFetch<{ id: string }>("/session/practice-batch", {
      method: "POST",
      body: JSON.stringify({ problem }),
    });
  },

  completePracticeBatch(
    sessionId: string,
    data: { total_questions: number; correct_count: number },
  ) {
    return apiFetch<{ status: string }>(
      `/session/practice-batch/${sessionId}/complete`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  },
};

// ── Practice endpoints ──

export const practice = {
  generate(data: { problem: string; count: number; subject: string; image_base64?: string }) {
    return apiFetch<PracticeGenerateResponse>("/practice/generate", {
      method: "POST",
      body: JSON.stringify(data),
      timeout: LLM_TIMEOUT,
    });
  },

  check(data: {
    question: string;
    correct_answer: string;
    user_answer: string;
    subject: string;
  }) {
    return apiFetch<PracticeCheckResponse>("/practice/check", {
      method: "POST",
      body: JSON.stringify(data),
      timeout: LLM_TIMEOUT,
    });
  },
};

// ── Image endpoints ──

export const image = {
  extract(imageBase64: string, subject: string) {
    return apiFetch<ImageExtractResponse>("/image/extract", {
      method: "POST",
      body: JSON.stringify({ image_base64: imageBase64, subject }),
      timeout: LLM_TIMEOUT,
    });
  },
};

// ── Work endpoints ──

export const work = {
  submit(data: {
    image_base64: string;
    problem_text: string;
    user_answer: string;
    user_was_correct: boolean;
    subject: string;
  }) {
    return apiFetch<WorkSubmitResponse>("/work/submit", {
      method: "POST",
      body: JSON.stringify(data),
      timeout: LLM_TIMEOUT,
    });
  },
};

// ── Stripe endpoints ──

export const stripe = {
  createCheckoutSession(priceId: string, successUrl: string, cancelUrl: string) {
    return apiFetch<{ checkout_url: string }>("/stripe/checkout-session", {
      method: "POST",
      body: JSON.stringify({
        price_id: priceId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      }),
    });
  },

  createPortalSession(returnUrl: string) {
    return apiFetch<{ portal_url: string }>("/stripe/portal-session", {
      method: "POST",
      body: JSON.stringify({ return_url: returnUrl }),
    });
  },
};
