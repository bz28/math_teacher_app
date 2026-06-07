const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/v1";

// ── Network error + API health pub/sub ─────────────────────────────
//
// Mirrors web/src/lib/api.ts. NetworkError marks the case where the
// request never received a server response (DNS failure, TCP refused,
// CORS preflight blocked by a dead container) — distinct from a
// non-2xx HTTP response, which still proves the backend is reachable.
//
// `apiHealth` is a tiny pub/sub the ServiceStatusBanner subscribes to.
// We flip `down` on any NetworkError; any successful response clears
// it. No debouncing — outages are infrequent and a quick flicker is
// preferable to staring at a frozen UI for 30 seconds.

export class NetworkError extends Error {
  cause: "fetch_failed" | "timeout";
  constructor(cause: "fetch_failed" | "timeout", message?: string) {
    super(
      message ??
        (cause === "timeout"
          ? "The request took too long. Please try again."
          : "Can't reach our servers right now. Please try again in a moment."),
    );
    this.name = "NetworkError";
    this.cause = cause;
  }
}

type ApiHealthListener = (down: boolean) => void;
const apiHealthListeners = new Set<ApiHealthListener>();
let apiHealthDown = false;

function setApiHealth(down: boolean) {
  if (apiHealthDown === down) return;
  apiHealthDown = down;
  apiHealthListeners.forEach((fn) => fn(down));
}

export const apiHealth = {
  isDown(): boolean {
    return apiHealthDown;
  },
  subscribe(fn: ApiHealthListener): () => void {
    apiHealthListeners.add(fn);
    return () => apiHealthListeners.delete(fn);
  },
};

// Wraps `fetch` so network failures become a typed NetworkError and
// the global health flag is kept in sync. Every call site that hits
// the API in this file routes through here (withAuth's inner fetch,
// login, forgotPassword). Refresh is intentionally not wrapped: its
// own swallowed failure already returns "transient_error" and we
// don't want a refresh blip alone to flash the banner.
async function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(input, init);
    if (apiHealthDown) setApiHealth(false);
    return res;
  } catch (e) {
    const isTimeout = (e as { name?: string }).name === "AbortError";
    setApiHealth(true);
    throw new NetworkError(isTimeout ? "timeout" : "fetch_failed");
  }
}

// ── Token storage ──────────────────────────────────────────────────
//
// Switched from sessionStorage (per-tab, dies on tab close) to
// localStorage so the refresh token can outlive a tab. Without
// persistence, the backend's 7-day refresh-token TTL is wasted
// — every browser restart forced a fresh login. The teacher portal
// (web/src/lib/api.ts) uses the same storage choice for the same
// reason; admin tooling has the same tradeoff.

const ACCESS_TOKEN_KEY = "admin_access_token";
const REFRESH_TOKEN_KEY = "admin_refresh_token";

// One-shot migration from the old sessionStorage key. Drop after a
// few release cycles when no operator still has a stale tab open.
const LEGACY_TOKEN_KEY = "admin_token";
const legacyToken = sessionStorage.getItem(LEGACY_TOKEN_KEY);
if (legacyToken && !localStorage.getItem(ACCESS_TOKEN_KEY)) {
  localStorage.setItem(ACCESS_TOKEN_KEY, legacyToken);
  sessionStorage.removeItem(LEGACY_TOKEN_KEY);
}

function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token);
  else clearTokens();
}

function saveTokens(tokens: { access_token: string; refresh_token: string }) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
}

function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function getToken() {
  return getAccessToken();
}

export function getUserRole(): string | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

// ── Refresh-token rotation ─────────────────────────────────────────
//
// Before this, the dashboard had no refresh logic at all — any 401
// (which happens every ~15 min when the access token expires) kicked
// the operator to login. Now we mirror the teacher portal's pattern:
// on 401, attempt a refresh, retry on success, only clear tokens and
// redirect when the refresh itself is auth-rejected.
//
// RefreshResult is a discriminated union (not a boolean + global
// flag) so concurrent 401s sharing one in-flight refresh each read
// their own answer from the promise. See web/src/lib/api.ts for the
// fuller writeup on why the flag approach is racy.

type RefreshResult = "success" | "auth_rejected" | "transient_error";

let refreshPromise: Promise<RefreshResult> | null = null;

async function refreshAccessToken(): Promise<RefreshResult> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const rt = getRefreshToken();
    if (!rt) return "auth_rejected" as const;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (res.status === 401) return "auth_rejected" as const;
      if (!res.ok) return "transient_error" as const;
      const data = await res.json();
      saveTokens(data);
      return "success" as const;
    } catch {
      return "transient_error" as const;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// ── Core fetch with auto-refresh ───────────────────────────────────

async function withAuth<T>(
  doFetch: (token: string | null) => Promise<Response>,
  parseBody: (res: Response) => Promise<T>,
): Promise<T> {
  let res = await doFetch(getAccessToken());

  // Only refresh on 401. A 403 is a permission problem (the user is
  // authenticated, just not allowed) — refresh wouldn't help, so we
  // let it fall through to the generic error path. The teacher
  // portal (web/src/lib/api.ts) does the same and we don't want
  // dashboard 403s to silently log out a viewer-role admin who just
  // tried a write endpoint or an audit page they can't see.
  if (res.status === 401) {
    const result = await refreshAccessToken();
    if (result === "success") {
      res = await doFetch(getAccessToken());
    } else if (result === "auth_rejected") {
      clearTokens();
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }
    // transient_error → fall through and let the caller see the 401
  }

  // Post-refresh 401 still terminates: refresh succeeded but the
  // retry was rejected (token revoked between attempts, role
  // downgraded, etc.). Send them to login. 403 deliberately not
  // here — see the comment above.
  if (res.status === 401) {
    clearTokens();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `API error ${res.status}`);
  }
  return parseBody(res);
}

async function request<T>(path: string, params?: Record<string, string>): Promise<T> {
  return withAuth(
    (token) => {
      const url = new URL(`${API_BASE}${path}`);
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
        }
      }
      return trackedFetch(url.toString(), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    },
    (res) => res.json() as Promise<T>,
  );
}

async function mutate<T>(path: string, method: string, body?: object): Promise<T> {
  return withAuth(
    (token) => trackedFetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    (res) => res.json() as Promise<T>,
  );
}

export interface HarnessRun {
  id: string;
  probe: string;
  mode: string;
  items_generated: number;
  det_pass: number;
  det_total: number;
  captures: number;
  judge_count: number;
  judge_mean: number | null;
  cost_usd: number | null;
  passed: boolean;
  note: string | null;
  prompt: string | null;
  created_at: string;
}

export interface HarnessRunsData {
  runs: HarnessRun[];
  total_count: number;
  by_probe: { probe: string; runs: number; avg_judge: number | null; total_cost: number }[];
}

export const api = {
  overview: (params?: Record<string, string>) => request<OverviewData>("/admin/overview", params),
  llmCalls: (params?: Record<string, string>) => request<LLMCallsData>("/admin/llm-calls", params),
  harnessRuns: (params?: Record<string, string>) => request<HarnessRunsData>("/admin/harness-runs", params),
  harnessReport: (id: string) => request<{ html: string }>(`/admin/harness-runs/${id}/report`),
  quality: (params?: Record<string, string>) => request<QualityData>("/admin/quality", params),
  users: (params?: Record<string, string>) => request<UsersData>("/admin/users", params),
  updateUserRole: (userId: string, role: string) => mutate<{ status: string }>(`/admin/users/${userId}/role`, "PATCH", { role }),
  deleteUser: (userId: string) => mutate<{ status: string }>(`/admin/users/${userId}`, "DELETE"),
  updateUserSubscription: (userId: string, tier: string, status: string) =>
    mutate<{ status: string }>(`/admin/users/${userId}/subscription`, "PATCH", { tier, status }),
  resetDailyLimit: (userId: string) => mutate<{ status: string }>(`/admin/users/${userId}/reset-daily-limit`, "POST"),
  debugLLMCall: (callId: string) =>
    mutate<{ status: string; call_id: string }>(`/admin/llm-calls/${callId}/debug`, "POST"),
  inviteAdmin: (email: string, name: string) => mutate<{ status: string }>("/admin/users/invite", "POST", { email, name }),
  teacherStudents: (teacherId: string, params?: Record<string, string>) =>
    request<TeacherStudentsData>(`/admin/users/${teacherId}/students`, params),
  // Leads
  leads: () => request<{ leads: ContactLeadData[] }>("/admin/leads"),
  lead: (id: string) => request<LeadDetail>(`/admin/leads/${id}`),
  createLead: (body: CreateLeadBody) =>
    mutate<{ id: string; status: string }>("/admin/leads", "POST", body),
  updateLead: (leadId: string, patch: UpdateLeadBody) =>
    mutate<{ status: string }>(`/admin/leads/${leadId}`, "PATCH", patch),
  deleteLead: (leadId: string) =>
    mutate<{ status: string }>(`/admin/leads/${leadId}`, "DELETE"),
  // Lead meetings
  createLeadMeeting: (leadId: string, body: CreateMeetingBody) =>
    mutate<{ id: string; status: string }>(`/admin/leads/${leadId}/meetings`, "POST", body),
  updateLeadMeeting: (leadId: string, meetingId: string, body: UpdateMeetingBody) =>
    mutate<{ status: string }>(`/admin/leads/${leadId}/meetings/${meetingId}`, "PATCH", body),
  deleteLeadMeeting: (leadId: string, meetingId: string) =>
    mutate<{ status: string }>(`/admin/leads/${leadId}/meetings/${meetingId}`, "DELETE"),
  // Lead notes
  createLeadNote: (leadId: string, body: string) =>
    mutate<{ id: string; status: string }>(`/admin/leads/${leadId}/notes`, "POST", { body }),
  updateLeadNote: (leadId: string, noteId: string, body: string) =>
    mutate<{ status: string }>(`/admin/leads/${leadId}/notes/${noteId}`, "PATCH", { body }),
  deleteLeadNote: (leadId: string, noteId: string) =>
    mutate<{ status: string }>(`/admin/leads/${leadId}/notes/${noteId}`, "DELETE"),
  // Schools
  schools: () => request<{ schools: SchoolListItem[] }>("/admin/schools"),
  school: (id: string) => request<SchoolDetail>(`/admin/schools/${id}`),
  schoolOverview: (id: string) => request<SchoolOverviewData>(`/admin/schools/${id}/overview`),
  schoolStudents: (id: string, params?: Record<string, string>) =>
    request<SchoolStudentsData>(`/admin/schools/${id}/students`, params),
  createSchool: (body: CreateSchoolBody) => mutate<{ id: string; status: string }>("/admin/schools", "POST", body),
  updateSchool: (id: string, body: UpdateSchoolBody) => mutate<{ status: string }>(`/admin/schools/${id}`, "PATCH", body),
  inviteTeacher: (schoolId: string, email: string) =>
    mutate<{ status: string; invite_url: string }>(`/admin/schools/${schoolId}/invite`, "POST", { email }),
  deleteSchool: (id: string) =>
    mutate<{ status: string; teachers_unlinked: number; invites_deleted: number }>(`/admin/schools/${id}`, "DELETE"),
  cancelInvite: (schoolId: string, inviteId: string) =>
    mutate<{ status: string }>(`/admin/schools/${schoolId}/invites/${inviteId}`, "DELETE"),
  login: async (email: string, password: string) => {
    const res = await trackedFetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error("Login failed");
    const data = await res.json();
    saveTokens(data);
    return data;
  },
  forgotPassword: async (email: string) => {
    const res = await trackedFetch(`${API_BASE}/auth/forgot-password`, {
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
  repo: string;
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

// Lead types
export type LeadSource = "inbound_form" | "warm_intro" | "outbound" | "event";
export type LeadStatus =
  | "new"
  | "contacted"
  | "engaged"
  | "demo_held"
  | "converted"
  | "declined";
export type MeetingType =
  // Scheduled meetings
  | "demo"
  | "follow_up"
  | "onboarding"
  | "other"
  // Contact touchpoints — logged after-the-fact, usually with
  // alreadyHappened=true as the natural default.
  | "email"
  | "call"
  | "dm"
  | "text"
  | "linkedin";

export interface ContactLeadData {
  id: string;
  school_name: string;
  contact_name: string;
  contact_email: string;
  role: string;
  approx_students: number | null;
  message: string | null;
  status: LeadStatus;
  source: LeadSource;
  referred_by: string | null;
  next_meeting_at: string | null;
  next_meeting_type: MeetingType | null;
  last_touch_at: string;
  last_touch_kind: "created" | "meeting" | "note";
  created_at: string;
  updated_at: string | null;
  updated_by: string | null;
  school_id: string | null;
}

export interface LeadMeeting {
  id: string;
  type: MeetingType;
  scheduled_at: string;
  held_at: string | null;
  cancelled_at: string | null;
  agenda: string | null;
  outcome: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export interface LeadNote {
  id: string;
  body: string;
  created_at: string;
  created_by: string | null;
  updated_at: string | null;
}

export interface LeadDetail extends ContactLeadData {
  meetings: LeadMeeting[];
  notes: LeadNote[];
}

export interface CreateLeadBody {
  school_name: string;
  contact_name: string;
  contact_email: string;
  role?: string;
  source: LeadSource;
  referred_by?: string | null;
  approx_students?: number | null;
  initial_note?: string | null;
}

export interface UpdateLeadBody {
  status?: LeadStatus;
  source?: LeadSource;
  referred_by?: string | null;
  school_id?: string;
  approx_students?: number | null;
  school_name?: string;
  contact_name?: string;
  contact_email?: string;
}

export interface CreateMeetingBody {
  type: MeetingType;
  scheduled_at: string;
  agenda?: string | null;
  held_at?: string | null;
  outcome?: string | null;
}

export interface UpdateMeetingBody {
  type?: MeetingType;
  scheduled_at?: string;
  agenda?: string | null;
  held_at?: string | null;
  outcome?: string | null;
  cancelled_at?: string | null;
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
  cost_30d: number;
  cost_prev_30d: number;
  last_activity_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  updated_by: string | null;
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
  teachers: {
    id: string;
    name: string;
    email: string;
    joined_at: string;
    call_count_30d: number;
    total_cost_30d: number;
  }[];
  pending_invites: { id: string; email: string; expires_at: string; created_at: string }[];
}

export interface ActivityCounts {
  active_classes: number;
  active_teachers: number;
  active_students: number;
  hws_published: number;
  submissions: number;
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
    trend_12_weeks: { week_start: string | null; cost: number }[];
  };
  activity: {
    this_week: ActivityCounts;
    last_week: ActivityCounts;
  };
  failed_calls_24h: number;
  failed_calls_7d: number;
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

export interface TeacherRosterStudent {
  id: string;
  email: string;
  name: string;
  grade_level: number;
  registered: string;
  last_active: string | null;
  subscription_tier: string;
  subscription_status: string;
}

export interface TeacherRosterSection {
  id: string;
  name: string;
  course_id: string;
}

export interface SchoolStudentsData {
  school: {
    id: string;
    name: string;
    kind: string;
  };
  total_students: number;
  students: TeacherRosterStudent[];
}

export interface TeacherStudentsData {
  teacher: {
    id: string;
    name: string;
    email: string;
    subscription_tier: string;
    subscription_status: string;
    school_id: string | null;
    call_count_30d: number;
    total_cost_30d: number;
  };
  sections: TeacherRosterSection[];
  total_students: number;
  students: TeacherRosterStudent[];
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
    classroom: {
      sections: number;
      students: number;
      submissions_30d: number;
    };
  }[];
}

