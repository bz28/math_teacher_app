const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/v1";

let _token: string | null = sessionStorage.getItem("admin_token");

export function setToken(token: string | null) {
  _token = token;
  if (token) sessionStorage.setItem("admin_token", token);
  else sessionStorage.removeItem("admin_token");
}

export function getToken() {
  return _token;
}

export function getUserRole(): string | null {
  if (!_token) return null;
  try {
    const payload = JSON.parse(atob(_token.split(".")[1]));
    return payload.role ?? null;
  } catch {
    return null;
  }
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

async function mutate<T>(path: string, method: string, body?: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 || res.status === 403) {
    setToken(null);
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `API error ${res.status}`);
  }
  return res.json();
}

export const api = {
  overview: (params?: Record<string, string>) => request<OverviewData>("/admin/overview", params),
  llmCalls: (params?: Record<string, string>) => request<LLMCallsData>("/admin/llm-calls", params),
  quality: (params?: Record<string, string>) => request<QualityData>("/admin/quality", params),
  users: (params?: Record<string, string>) => request<UsersData>("/admin/users", params),
  updateUserRole: (userId: string, role: string) => mutate<{ status: string }>(`/admin/users/${userId}/role`, "PATCH", { role }),
  deleteUser: (userId: string) => mutate<{ status: string }>(`/admin/users/${userId}`, "DELETE"),
  updateUserSubscription: (userId: string, tier: string, status: string) =>
    mutate<{ status: string }>(`/admin/users/${userId}/subscription`, "PATCH", { tier, status }),
  resetDailyLimit: (userId: string) => mutate<{ status: string }>(`/admin/users/${userId}/reset-daily-limit`, "POST"),
  inviteAdmin: (email: string, name: string) => mutate<{ status: string }>("/admin/users/invite", "POST", { email, name }),
  // Leads
  leads: () => request<{ leads: ContactLeadData[] }>("/admin/leads"),
  updateLeadStatus: (leadId: string, status: string, schoolId?: string) =>
    mutate<{ status: string }>(`/admin/leads/${leadId}`, "PATCH", { status, ...(schoolId ? { school_id: schoolId } : {}) }),
  // Schools
  schools: () => request<{ schools: SchoolListItem[] }>("/admin/schools"),
  school: (id: string) => request<SchoolDetail>(`/admin/schools/${id}`),
  schoolOverview: (schoolId: string) =>
    request<SchoolOverviewData>(`/admin/schools/${schoolId}/overview`),
  createSchool: (body: CreateSchoolBody) => mutate<{ id: string; status: string }>("/admin/schools", "POST", body),
  updateSchool: (id: string, body: UpdateSchoolBody) => mutate<{ status: string }>(`/admin/schools/${id}`, "PATCH", body),
  inviteTeacher: (schoolId: string, email: string) =>
    mutate<{ status: string; invite_url: string }>(`/admin/schools/${schoolId}/invite`, "POST", { email }),
  deleteSchool: (id: string) =>
    mutate<{ status: string; teachers_unlinked: number; invites_deleted: number }>(`/admin/schools/${id}`, "DELETE"),
  cancelInvite: (schoolId: string, inviteId: string) =>
    mutate<{ status: string }>(`/admin/schools/${schoolId}/invites/${inviteId}`, "DELETE"),
  // Promo codes
  promoCodes: (params?: Record<string, string>) => request<PromoCodeData[]>("/promo/codes", params),
  createPromoCode: (body: CreatePromoCodeBody) => mutate<PromoCodeData>("/promo/codes", "POST", body),
  updatePromoCode: (codeId: string, body: UpdatePromoCodeBody) => mutate<PromoCodeData>(`/promo/codes/${codeId}`, "PATCH", body),
  promoRedemptions: (codeId: string) => request<PromoRedemptionData[]>(`/promo/codes/${codeId}/redemptions`),
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
  forgotPassword: async (email: string) => {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error("Request failed");
    return res.json();
  },
};

// Types
export interface OverviewData {
  total_sessions: number;
  active_users: number;
  new_users: number;
  total_users: number;
  deleted_accounts: number;
  total_cost: number;
  total_calls: number;
  failed_calls: number;
  error_rate: number;
  avg_latency_ms: number;
  by_mode: { mode: string; count: number }[];
  by_subject: { subject: string; count: number }[];
  sessions_by_day: { day: string; count: number }[];
  cost_by_day: { day: string; cost: number }[];
  top_spenders: { name: string; total_cost: number }[];
}

export interface LLMCallsData {
  failure_count: number;
  failure_rate: number;
  failures_by_function: { function: string; count: number; avg_retries: number }[];
  recent_failures: {
    id: string;
    function: string;
    model: string;
    retry_count: number;
    output_text: string | null;
    user_name: string | null;
    created_at: string;
  }[];
  by_function: {
    function: string;
    count: number;
    total_cost: number;
    avg_latency_ms: number;
    avg_input_tokens: number;
    avg_output_tokens: number;
  }[];
  by_model: { model: string; count: number; total_cost: number }[];
  by_day: { day: string; count: number; cost: number; avg_latency: number }[];
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
    user_id: string | null;
    user_name: string | null;
    school_id: string | null;
    submission_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }[];
  total_count: number;
  users: { id: string; email: string }[];
}

export interface QualityData {
  summary: {
    total: number;
    passed: number;
    pass_rate: number;
    avg_correctness: number;
    avg_optimality: number;
    avg_clarity: number;
    avg_flow: number;
  };
  scores: {
    id: string;
    session_id: string;
    problem: string;
    correctness: number;
    optimality: number;
    clarity: number;
    flow: number;
    passed: boolean;
    issues: string | null;
    created_at: string;
  }[];
  total_count: number;
}

export interface PromoCodeData {
  id: string;
  code: string;
  duration_days: number;
  max_redemptions: number;
  times_redeemed: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  updated_by: string | null;
}

export interface CreatePromoCodeBody {
  code: string;
  duration_days: number;
  max_redemptions: number;
  expires_at?: string | null;
}

export interface UpdatePromoCodeBody {
  is_active?: boolean;
  max_redemptions?: number;
  expires_at?: string | null;
}

export interface PromoRedemptionData {
  user_id: string;
  user_email: string;
  redeemed_at: string;
  expires_at: string | null;
}

// Lead types
export interface ContactLeadData {
  id: string;
  school_name: string;
  contact_name: string;
  contact_email: string;
  role: string;
  approx_students: number | null;
  message: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  updated_by: string | null;
  school_id: string | null;
}

// School types
export interface SchoolListItem {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  contact_name: string;
  contact_email: string;
  is_active: boolean;
  teacher_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  updated_by: string | null;
}

export interface SchoolOverviewData {
  school_id: string;
  school_name: string;
  is_internal: boolean;
  generated_at: string;
  cost: {
    this_month: number;
    last_month: number;
    projected_month_end: number;
    cost_per_submission: number;
    by_function: { function: string; cost: number; count: number }[];
    trend_12_weeks: { week_start: string | null; cost: number }[];
  };
  top_spenders: {
    classes: {
      section_id: string;
      section_name: string;
      course_name: string;
      cost: number;
    }[];
    teachers: {
      teacher_id: string;
      teacher_name: string;
      teacher_email: string;
      cost: number;
    }[];
    submissions_this_week: {
      submission_id: string;
      cost: number;
      call_count: number;
    }[];
  };
  quality: {
    integrity_disposition: { disposition: string; count: number }[];
    ai_override_rate: number | null;
    unreadable_per_teacher: {
      teacher_id: string;
      teacher_name: string;
      total_submissions: number;
      unreadable_count: number;
      rate: number;
    }[];
    failed_calls_24h: number;
    failed_calls_7d: number;
  };
  health: {
    this_week: HealthCounts;
    last_week: HealthCounts;
  };
}

export interface HealthCounts {
  active_classes: number;
  active_teachers: number;
  active_students: number;
  hws_published: number;
  submissions: number;
}

export interface SchoolDetail {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  contact_name: string;
  contact_email: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  teachers: { id: string; name: string; email: string; joined_at: string }[];
  pending_invites: { id: string; email: string; expires_at: string; created_at: string }[];
}

export interface CreateSchoolBody {
  name: string;
  contact_name: string;
  contact_email: string;
  city?: string;
  state?: string;
  notes?: string;
}

export interface UpdateSchoolBody {
  name?: string;
  city?: string;
  state?: string;
  contact_name?: string;
  contact_email?: string;
  is_active?: boolean;
  notes?: string;
}

export interface UsersData {
  total_users: number;
  active_7d: number;
  total_spend: number;
  filtered_count: number;
  registrations_by_day: { day: string; count: number }[];
  users: {
    id: string;
    email: string;
    name: string;
    role: string;
    grade_level: number;
    session_count: number;
    total_cost: number;
    llm_call_count: number;
    avg_cost_per_session: number;
    last_active: string | null;
    registered: string;
    subscription_tier: string;
    subscription_status: string;
    daily_usage: {
      sessions: number;
      sessions_limit: number | null;
      chats: number;
      chats_limit: number | null;
      scans: number;
      scans_limit: number | null;
    };
  }[];
}

