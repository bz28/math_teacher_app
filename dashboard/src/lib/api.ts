const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/v1";

let _token: string | null = localStorage.getItem("admin_token");

export function setToken(token: string | null) {
  _token = token;
  if (token) localStorage.setItem("admin_token", token);
  else localStorage.removeItem("admin_token");
}

export function getToken() {
  return _token;
}

async function request<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: _token ? { Authorization: `Bearer ${_token}` } : {},
  });

  if (res.status === 401 || res.status === 403) {
    setToken(null);
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export const api = {
  overview: () => request<OverviewData>("/admin/overview"),
  llmCalls: (params?: Record<string, string>) => request<LLMCallsData>("/admin/llm-calls", params),
  sessions: (params?: Record<string, string>) => request<SessionsData>("/admin/sessions", params),
  users: (params?: Record<string, string>) => request<UsersData>("/admin/users", params),
  login: async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error("Login failed");
    const data = await res.json();
    setToken(data.access_token);
    return data;
  },
};

// Types
export interface OverviewData {
  sessions_today: number;
  sessions_yesterday: number;
  cost_today: number;
  cost_yesterday: number;
  active_users_7d: number;
  completion_rate_7d: number;
  sessions_by_day: { day: string; count: number }[];
  cost_by_day: { day: string; cost: number }[];
  recent_sessions: {
    id: string;
    problem: string;
    mode: string;
    status: string;
    total_steps: number;
    current_step: number;
    created_at: string;
  }[];
}

export interface LLMCallsData {
  by_function: {
    function: string;
    count: number;
    total_cost: number;
    avg_latency_ms: number;
    avg_input_tokens: number;
    avg_output_tokens: number;
  }[];
  by_model: { model: string; count: number; total_cost: number }[];
  by_day: { day: string; count: number; cost: number }[];
  calls: {
    id: string;
    function: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
    cost_usd: number;
    input_text: string | null;
    output_text: string | null;
    success: boolean;
    retry_count: number;
    session_id: string | null;
    created_at: string;
  }[];
  total_count: number;
}

export interface SessionsData {
  completion_by_day: { day: string; total: number; completed: number; rate: number }[];
  by_mode: { mode: string; count: number; completed: number; rate: number }[];
  averages: { avg_steps: number; avg_progress: number };
  top_problems: { problem: string; count: number; completed: number; rate: number }[];
  sessions: {
    id: string;
    problem: string;
    mode: string;
    status: string;
    problem_type: string;
    current_step: number;
    total_steps: number;
    created_at: string;
  }[];
  abandoned: {
    id: string;
    problem: string;
    mode: string;
    current_step: number;
    total_steps: number;
    created_at: string;
  }[];
  total_count: number;
}

export interface UsersData {
  total_users: number;
  active_7d: number;
  registrations_by_day: { day: string; count: number }[];
  session_distribution: Record<string, number>;
  top_users: {
    id: string;
    email: string;
    grade_level: string;
    session_count: number;
    last_active: string | null;
  }[];
}
