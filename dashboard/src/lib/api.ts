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
  // Promo codes
  promoCodes: (params?: Record<string, string>) => request<PromoCodeData[]>("/promo/codes", params),
  createPromoCode: (body: CreatePromoCodeBody) => mutate<PromoCodeData>("/promo/codes", "POST", body),
  updatePromoCode: (codeId: string, body: UpdatePromoCodeBody) => mutate<PromoCodeData>(`/promo/codes/${codeId}`, "PATCH", body),
  promoRedemptions: (codeId: string) => request<PromoRedemptionData[]>(`/promo/codes/${codeId}/redemptions`),
  // Teacher
  teacherCourses: () => request<TeacherCoursesData>("/teacher/courses"),
  teacherCourse: (id: string) => request<TeacherCourseData>(`/teacher/courses/${id}`),
  teacherCreateCourse: (body: { name: string; subject?: string; grade_level?: number }) =>
    mutate<{ id: string }>("/teacher/courses", "POST", body),
  teacherUpdateCourse: (id: string, body: Record<string, unknown>) =>
    mutate<{ status: string }>(`/teacher/courses/${id}`, "PATCH", body),
  teacherDeleteCourse: (id: string) => mutate<{ status: string }>(`/teacher/courses/${id}`, "DELETE"),
  teacherSections: (courseId: string) => request<TeacherSectionsData>(`/teacher/courses/${courseId}/sections`),
  teacherSection: (courseId: string, sectionId: string) =>
    request<TeacherSectionDetailData>(`/teacher/courses/${courseId}/sections/${sectionId}`),
  teacherCreateSection: (courseId: string, name: string) =>
    mutate<{ id: string }>(`/teacher/courses/${courseId}/sections`, "POST", { name }),
  teacherDeleteSection: (courseId: string, sectionId: string) =>
    mutate<{ status: string }>(`/teacher/courses/${courseId}/sections/${sectionId}`, "DELETE"),
  teacherAddStudent: (courseId: string, sectionId: string, email: string) =>
    mutate<{ status: string }>(`/teacher/courses/${courseId}/sections/${sectionId}/students`, "POST", { email }),
  teacherRemoveStudent: (courseId: string, sectionId: string, studentId: string) =>
    mutate<{ status: string }>(`/teacher/courses/${courseId}/sections/${sectionId}/students/${studentId}`, "DELETE"),
  teacherGenerateJoinCode: (courseId: string, sectionId: string) =>
    mutate<{ join_code: string }>(`/teacher/courses/${courseId}/sections/${sectionId}/join-code`, "POST"),
  teacherDocuments: (courseId: string) => request<TeacherDocumentsData>(`/teacher/courses/${courseId}/documents`),
  teacherDocument: (courseId: string, docId: string) =>
    request<TeacherDocumentDetailData>(`/teacher/courses/${courseId}/documents/${docId}`),
  teacherUploadDocument: (courseId: string, body: { image_base64: string; filename: string }) =>
    mutate<{ id: string }>(`/teacher/courses/${courseId}/documents`, "POST", body),
  teacherDeleteDocument: (courseId: string, docId: string) =>
    mutate<{ status: string }>(`/teacher/courses/${courseId}/documents/${docId}`, "DELETE"),
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
  total_sessions: number;
  active_users: number;
  new_users: number;
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

// Teacher types
export interface TeacherCoursesData {
  courses: {
    id: string; name: string; subject: string; grade_level: number | null;
    status: string; section_count: number; doc_count: number; created_at: string;
  }[];
}

export interface TeacherCourseData {
  id: string; name: string; subject: string; grade_level: number | null;
  description: string | null; status: string; created_at: string;
}

export interface TeacherSectionsData {
  sections: {
    id: string; name: string; student_count: number;
    join_code: string | null; join_code_expires_at: string | null;
  }[];
}

export interface TeacherSectionDetailData {
  id: string; name: string;
  join_code: string | null; join_code_expires_at: string | null;
  students: { id: string; name: string; email: string }[];
}

export interface TeacherDocumentsData {
  documents: {
    id: string; filename: string; file_type: string;
    file_size: number; created_at: string;
  }[];
}

export interface TeacherDocumentDetailData {
  id: string; filename: string; file_type: string;
  file_size: number; image_data: string | null; created_at: string;
}
