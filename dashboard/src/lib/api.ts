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

/** The signed-in admin's own user id (JWT `sub`), or null. */
export function getUserId(): string | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub ?? null;
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

// Authed file download — same 401→refresh path as `request`, but pulls
// the body as a Blob and reads the server's filename off the
// Content-Disposition so a CSV export saves with the right name.
async function download(path: string, params?: Record<string, string>): Promise<void> {
  const { blob, filename } = await withAuth(
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
    async (res) => {
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^"]+)"?/.exec(cd);
      return { blob: await res.blob(), filename: match?.[1] ?? "export.csv" };
    },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * What deleting an account would destroy. Fetched before the confirm
 * dialog so the operator is shown the real damage rather than a
 * generic "this can't be undone".
 *
 * `students_affected` is the one that matters: deleting a TEACHER
 * cascades through their assignments into every submission and grade
 * on them, so the people who lose work are usually not the person
 * being deleted.
 */
export interface UserDeleteImpact {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  assignments_destroyed: number;
  submissions_destroyed: number;
  grades_destroyed: number;
  students_affected: number;
  enrollments_removed: number;
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

/** Per-probe current health — the AI-quality regression alarm band. */
export interface ProbeHealth {
  probe: string;
  latest_run_id: string;
  latest_mode: string;
  latest_passed: boolean;
  latest_det_pass: number;
  latest_det_total: number;
  /** Previous run's deterministic result, for the regression delta (null if the probe has only ever run once). */
  prev_det_pass: number | null;
  prev_det_total: number | null;
  /** Most recent non-null judge score in the window — NOT a lifetime average. */
  recent_judge_mean: number | null;
  last_run_at: string;
  /** Deterministic pass-rate (0–1) per recent run, oldest→newest. */
  spark: number[];
  total_runs: number;
}

export interface HarnessRunsData {
  runs: HarnessRun[];
  total_count: number;
  probe_health: ProbeHealth[];
  summary: {
    recent_window: number;
    recent_failing: number;
    recent_cost: number;
    probe_count: number;
    newest_run_at: string | null;
  };
}

export type GoldenStatus = "pass" | "fail" | "pending";

export interface GoldenCase {
  id: string;
  probe: string;
  name: string;
  constraint: string;
  adversarial: boolean;
  expected_shapes: string[];
  rationale: string | null;
  last_status: GoldenStatus;
  is_regression: boolean;
  last_run_at: string | null;
  last_model: string | null;
  last_run_id: string | null;
  last_output: string | null;
  rerun_requested: boolean;
  retired: boolean;
}

export interface GoldenSetData {
  cases: GoldenCase[];
  stats: {
    set_size: number;
    last_run: { at: string | null; model: string | null };
    pass_rate: { passing: number; evaluated: number };
    regressions: number;
  };
}

export interface GoldenCaseCreate {
  probe: string;
  name: string;
  constraint: string;
  adversarial: boolean;
  expected_shapes: string[];
  rationale: string | null;
}


// ── Generation quality ───────────────────────────────────────────────
// A generated question a teacher had to rewrite is the clearest signal
// the generation prompt is wrong. `tracking_since` rides on every
// response because these events are only recorded FORWARD — without it
// an empty page would read as "no teacher has ever edited a question".

export interface EditedQuestion {
  id: string;
  title: string;
  question: string;
  status: string;
  source: string;
  generation_prompt: string | null;
  edit_count: number;
  last_edited_at: string | null;
}

export interface EditedQuestionsData {
  questions: EditedQuestion[];
  total: number;
  tracking_since: string;
}

export interface QuestionEditEntry {
  id: string;
  kind: string;
  before: string | null;
  after: string | null;
  created_at: string;
  editor: string | null;
  school: string | null;
}

export interface QuestionEditHistory {
  id: string;
  title: string;
  question: string;
  final_answer: string | null;
  status: string;
  source: string;
  generation_prompt: string | null;
  edits: QuestionEditEntry[];
  tracking_since: string;
}

export interface GenerationQualitySummary {
  total_edits: number;
  questions_touched: number;
  by_kind: Record<string, number>;
  tracking_since: string;
}


/** One group of identical client-side errors (same fingerprint). */
export interface ClientErrorGroup {
  fingerprint: string;
  kind: string;
  message: string;
  stack: string | null;
  component_stack: string | null;
  route: string | null;
  user_agent: string | null;
  context: Record<string, unknown> | null;
  count: number;
  user_count: number;
  sample_user: string | null;
  first_seen: string;
  last_seen: string;
}

export interface ClientErrorsData {
  groups: ClientErrorGroup[];
  total_events: number;
  /** Distinct people affected in the window (server-computed on ids). */
  distinct_users: number;
  /** True when the scan cap bit — counts are a floor, not a total. */
  truncated: boolean;
}

export const api = {
  overview: (params?: Record<string, string>) => request<OverviewData>("/admin/overview", params),
  llmCalls: (params?: Record<string, string>) => request<LLMCallsData>("/admin/llm-calls", params),
  harnessRuns: (params?: Record<string, string>) => request<HarnessRunsData>("/admin/harness-runs", params),
  harnessReport: (id: string) => request<{ html: string }>(`/admin/harness-runs/${id}/report`),
  goldenSet: () => request<GoldenSetData>("/admin/golden-set"),
  addGoldenCase: (body: GoldenCaseCreate) => mutate<GoldenCase>("/admin/golden-set", "POST", body),
  retireGoldenCase: (id: string, retired: boolean) =>
    mutate<GoldenCase>(`/admin/golden-set/${id}/retire`, "PATCH", { retired }),
  rerunGoldenEval: (ids: string[] = []) =>
    mutate<{ requested: number }>("/admin/golden-set/rerun", "POST", { ids }),
  quality: (params?: Record<string, string>) => request<QualityData>("/admin/quality", params),
  qualitySession: (sessionId: string) =>
    request<QualitySessionDetail>(`/admin/quality/${sessionId}`),
  editedQuestions: (params?: Record<string, string>) =>
    request<EditedQuestionsData>("/admin/generation-quality/questions", params),
  questionEditHistory: (id: string) =>
    request<QuestionEditHistory>(`/admin/generation-quality/questions/${id}`),
  generationQualitySummary: (params?: Record<string, string>) =>
    request<GenerationQualitySummary>("/admin/generation-quality/summary", params),
  gradingQuality: (params?: Record<string, string>) =>
    request<GradingQualityData>("/admin/grading-quality", params),
  gradingQualityOverrides: (params?: Record<string, string>) =>
    request<GradingOverridesData>("/admin/grading-quality/overrides", params),
  users: (params?: Record<string, string>) => request<UsersData>("/admin/users", params),
  studentAccessLog: (params?: Record<string, string>) =>
    request<StudentAccessLogData>("/admin/audit-logs/student-access", params),
  activityLog: (params?: Record<string, string>) =>
    request<ActivityLogData>("/admin/activity", params),
  clientErrors: (params?: Record<string, string>) =>
    request<ClientErrorsData>("/admin/client-errors", params),
  auditTimeline: (params?: Record<string, string>) =>
    request<TimelineData>("/admin/audit-logs/timeline", params),
  downloadAuditTimelineCsv: (params?: Record<string, string>) =>
    download("/admin/audit-logs/timeline/export.csv", params),
  generationJobs: (params?: Record<string, string>) =>
    request<GenerationJobsData>("/admin/generation/jobs", params),
  generationJob: (id: string) =>
    request<GenerationJobDetail>(`/admin/generation/jobs/${id}`),
  documentContent: (id: string) =>
    request<DocumentContent>(`/admin/documents/${id}/content`),
  updateUserRole: (userId: string, role: string) => mutate<{ status: string }>(`/admin/users/${userId}/role`, "PATCH", { role }),
  deleteUser: (userId: string) => mutate<{ status: string }>(`/admin/users/${userId}`, "DELETE"),
  /** What a delete would destroy — asked before showing the confirm. */
  userDeleteImpact: (userId: string) =>
    request<UserDeleteImpact>(`/admin/users/${userId}/delete-impact`),
  /** The reversible alternative: revoke access, keep the work. */
  setUserActive: (userId: string, isActive: boolean) =>
    mutate<{ status: string; is_active: boolean }>(
      `/admin/users/${userId}/active`, "PATCH", { is_active: isActive },
    ),
  updateUserSubscription: (userId: string, tier: string, status: string) =>
    mutate<{ status: string }>(`/admin/users/${userId}/subscription`, "PATCH", { tier, status }),
  resetDailyLimit: (userId: string) => mutate<{ status: string }>(`/admin/users/${userId}/reset-daily-limit`, "POST"),
  debugLLMCall: (callId: string) =>
    mutate<{ status: string; call_id: string }>(`/admin/llm-calls/${callId}/debug`, "POST"),
  inviteAdmin: (email: string, name: string) => mutate<{ status: string }>("/admin/users/invite", "POST", { email, name }),
  resendInvite: (userId: string) => mutate<{ status: string }>(`/admin/users/${userId}/resend-invite`, "POST"),
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
    // Distinguish a rejected credential (401) from a server-side or
    // transient failure (5xx) so the login screen can surface the real
    // cause instead of blaming the operator's password. NetworkError
    // (timeout / unreachable) is thrown upstream by trackedFetch.
    if (!res.ok) {
      if (res.status === 401) throw new Error("Invalid credentials.");
      throw new Error(`Sign-in failed (${res.status}). Please try again.`);
    }
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
  // p95 of successful-call latency over the same window/population as
  // avg_latency_ms. Leads the latency tile — the average hides the
  // slow tail that actually degrades the experience.
  p95_latency_ms: number;
  by_mode: { mode: string; count: number }[];
  by_subject: { subject: string; count: number }[];
  sessions_by_day: { day: string; count: number }[];
  cost_by_day: { day: string; cost: number }[];
  top_spenders: { name: string; email: string | null; total_cost: number }[];
}

export interface LLMCallsData {
  total_count_window: number;
  total_cost_window: number;
  p95_latency_ms: number;
  failure_count: number;
  failure_rate: number;
  failures_by_function: { function: string; count: number; avg_retries: number }[];
  by_function: {
    function: string;
    count: number;
    total_cost: number;
    avg_latency_ms: number;
  }[];
  by_model: { model: string; count: number; total_cost: number }[];
  by_day: { day: string; count: number; cost: number; avg_latency: number }[];
  calls: {
    id: string;
    function: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    // Prompt-cache traffic. 0/0 means the call touched no cache — either
    // it sends no cache_control, or the cached prefix had expired (the
    // ephemeral cache lives 5 minutes). Pre-instrumentation rows are
    // backfilled to 0, so treat old calls as "unmeasured", not "no hits".
    cache_read_tokens: number;
    cache_write_tokens: number;
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
  /** Case-file identity + outcome for the single-submission trace view.
   *  Populated only when the request scopes to one submission_id; null on
   *  the general LLM-calls list. */
  submission: SubmissionSummary | null;
  users: { id: string; email: string }[];
  repo: string;
}

/** One subject/mode bucket in the quality breakdown, worst-first. */
export interface QualityBucket {
  name: string;
  evaluated: number;
  passed: number;
  pass_rate: number;
  avg_score: number;
}

export interface QualityScoreRow {
  id: string;
  session_id: string;
  problem: string;
  subject: string;
  mode: string;
  problem_type: string;
  correctness: number;
  optimality: number;
  clarity: number;
  flow: number;
  passed: boolean;
  issues: string | null;
  created_at: string;
}

/** The DECISIONS one graded submission produced — joined from the
 *  submission / grade / integrity-check tables so the SubmissionTrace
 *  header can read as a case file instead of a raw UUID. Scores are
 *  percentages (0–100), matching the teacher review UI. */
export interface SubmissionSummary {
  id: string;
  status: string | null;
  student_id: string | null;
  student_name: string | null;
  school_id: string | null;
  school_name: string | null;
  assignment_title: string | null;
  assignment_type: string | null;
  ai_score: number | null;
  final_score: number | null;
  ai_grading_status: string | null;
  graded_at: string | null;
  reviewed_at: string | null;
  grade_published_at: string | null;
  integrity_disposition: string | null;
  integrity_headline: string | null;
  integrity_status: string | null;
  integrity_resolution: string | null;
}

export interface QualityData {
  summary: {
    total: number;
    passed: number;
    failed: number;
    pass_rate: number;
    prior_pass_rate: number;
    prior_total: number;
    total_sessions: number;
    coverage_pct: number;
    avg_correctness: number;
    avg_optimality: number;
    avg_clarity: number;
    avg_flow: number;
  };
  trend: { day: string; evaluated: number; pass_rate: number }[];
  by_subject: QualityBucket[];
  by_mode: QualityBucket[];
  scores: QualityScoreRow[];
  total_count: number;
}

/** Drill-in: a single evaluated session — problem, the exact steps shown
 *  to the student, and the judge's verdict. */
export interface QualitySessionDetail {
  session: {
    id: string;
    problem: string;
    problem_type: string;
    subject: string;
    mode: string;
    status: string;
    total_steps: number;
    created_at: string | null;
    steps: { title: string; description: string; final_answer: string | null }[];
  };
  score: {
    correctness: number;
    optimality: number;
    clarity: number;
    flow: number;
    passed: boolean;
    issues: string | null;
    created_at: string | null;
  } | null;
}

// ── AI grading quality (teacher-override analytics) ──

export type GradingDirection = "too_harsh" | "too_generous" | "balanced";

/** Headline metrics shared by the global summary and every group bucket
 *  (subject, course, day). `mean_delta` is the signed direction signal:
 *  positive = teachers raised scores = AI too harsh. */
export interface GradingBucket {
  graded_problems: number;
  overridden_problems: number;
  override_rate: number;
  mean_delta: number;
  direction: GradingDirection;
  mean_override_magnitude: number;
  raised: number;
  lowered: number;
}

/** Global summary. `reviewed_submissions` is the count of comparable
 *  reviewed submissions in the report. `ai_graded_submissions` /
 *  `reviewed_ai_grades` are the review-coverage denominator/numerator:
 *  of every AI grade produced in the window, how many a teacher vetted. */
export type GradingSummary = GradingBucket & {
  reviewed_submissions: number;
  ai_graded_submissions: number;
  reviewed_ai_grades: number;
};

export interface GradingQualityData {
  summary: GradingSummary;
  status_matrix: { from: string; to: string; count: number; is_change: boolean }[];
  by_subject: (GradingBucket & { subject: string })[];
  by_course: (GradingBucket & { course: string; subject: string })[];
  trend: (GradingBucket & { day: string })[];
  subjects: string[];
}

/** One overridden problem behind a weak row or catastrophic cell — the
 *  AI's original call, the teacher's final, and the signed delta. */
export interface GradingOverrideCase {
  subject: string;
  course: string;
  day: string | null;
  ai_status: string;
  ai_percent: number;
  final_status: string;
  final_percent: number;
  delta: number;
}

export interface GradingOverridesData {
  cases: GradingOverrideCase[];
  total_count: number;
  truncated: boolean;
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
  student_count: number;
  cost_30d: number;
  cost_prev_30d: number;
  submissions_7d: number;
  failed_calls_24h: number;
  last_activity_at: string | null;
  // Unified recency = max(last submission, last ActivityLog action).
  // Prefer over last_activity_at for active/stale/dormant — folds in
  // teacher grade/publish actions that leave no student submission.
  last_active_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  updated_by: string | null;
}

// One enrolled student, scoped to a single section. NO subscription /
// plan — school students don't carry an individual plan. `avg_score` is
// the mean of that student's graded submissions in this section (0–100),
// null when nothing's been graded yet.
export interface SchoolSectionStudent {
  id: string;
  name: string;
  email: string;
  grade_level: number;
  /** False when an admin has revoked access without deleting. */
  is_active: boolean;
  submission_count: number;
  graded_count: number;
  avg_score: number | null;
  last_activity_at: string | null;
}

// A section (class period). `cost_30d` is the rolled-up per-submission AI
// cost (extraction + integrity + grading) for this section's work.
export interface SchoolSection {
  id: string;
  name: string;
  course_name: string;
  student_count: number;
  submitted_count: number;
  cost_30d: number;
  last_activity_at: string | null;
  students: SchoolSectionStudent[];
}

// A teacher and the classes they own. `gen_cost_30d` is the teacher's
// authoring/generation spend (calls not tied to a submission); per-
// submission cost lives on each section instead.
export interface SchoolTeacher {
  id: string;
  name: string;
  email: string;
  joined_at: string;
  /** False when an admin has revoked access without deleting. */
  is_active: boolean;
  gen_cost_30d: number;
  gen_call_count_30d: number;
  sections: SchoolSection[];
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
  teachers: SchoolTeacher[];
  // Sections whose owner isn't a current teacher of this school (a data
  // anomaly — the create flow always attaches an owner). Normally empty;
  // surfaced so their students never silently disappear.
  unassigned_sections: SchoolSection[];
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
  last_activity_at: string | null;
  // Unified recency = max(last submission, last ActivityLog action).
  // Prefer over last_activity_at for active/stale/dormant — folds in
  // teacher grade/publish actions that leave no student submission.
  last_active_at: string | null;
  cost: {
    this_month: number;
    last_month: number;
    cost_30d: number;
    cost_prev_30d: number;
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
  /** Which of the teacher's sections this student belongs to. Present on
   *  the per-teacher roster (drives click-to-filter); absent on the
   *  school-wide roster. */
  section_ids?: string[];
}

export interface TeacherRosterSection {
  id: string;
  name: string;
  course_id: string;
  student_count: number;
  last_activity_at: string | null;
}

/** The founder's "what is this teacher actually doing" rollup — all-time
 *  creation + grading footprint. Nulls mean "no homeworks yet". */
export interface TeacherUsage {
  homeworks_created: number;
  practice_sets: number;
  problems_per_homework: number | null;
  published: number;
  homeworks_per_week: number | null;
  last_created_at: string | null;
  submissions_received: number;
  graded: number;
  students_reached: number;
  generations: number;
}

export interface TeacherStudentsData {
  teacher: {
    id: string;
    name: string;
    email: string;
    subscription_tier: string;
    subscription_status: string;
    school_id: string | null;
    /** School context for the header breadcrumb. `kind` is
     *  "institutional" (→ School page) or "individual" (indie → the
     *  Independent Teachers list). Null for a school-less teacher. */
    school: { id: string; name: string; kind: string } | null;
    /** Teacher's own last action (from ActivityLog) — drives the header
     *  active/dormant verdict. Null if they've never acted. */
    last_active_at: string | null;
    call_count_30d: number;
    total_cost_30d: number;
  };
  usage: TeacherUsage;
  sections: TeacherRosterSection[];
  total_students: number;
  students: TeacherRosterStudent[];
}

export interface UsersData {
  total_users: number;
  active_7d: number;
  new_users: number;
  total_spend: number;
  filtered_count: number;
  registrations_by_day: { day: string; count: number }[];
  users: {
    id: string;
    email: string;
    name: string;
    role: string;
    grade_level: number;
    /** False when an admin has revoked access without deleting. */
    is_active: boolean;
    session_count: number;
    total_cost: number;
    llm_call_count: number;
    avg_cost_per_session: number;
    last_active: string | null;
    // Unified recency = max(last session, last ActivityLog action).
    // Prefer over last_active for active/stale/dormant — folds in a
    // teacher's grade/publish actions that leave no session.
    last_active_at: string | null;
    /** Most recent login (refresh-token issue). Best "last seen"
     *  signal for admins, who never run tutoring sessions. */
    last_login: string | null;
    /** Account activation state, surfaced on the Admin preset. */
    invite_status: "active" | "pending" | "expired";
    registered: string;
    subscription_tier: string;
    subscription_status: string;
    /** Institutional school affiliation, or null (solo / indie). */
    school: { id: string; name: string } | null;
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
      homeworks: number;
    };
  }[];
}

// ── Audit logs ──

export interface StudentAccessLogEntry {
  id: string;
  accessor_user_id: string | null;
  accessor_name: string | null;
  accessor_email: string | null;
  accessor_role: string;
  target_student_id: string | null;
  target_student_name: string | null;
  record_type: string;
  record_id: string | null;
  school_id: string | null;
  ip_address: string | null;
  accessed_at: string;
}

export interface StudentAccessLogData {
  total: number;
  limit: number;
  offset: number;
  entries: StudentAccessLogEntry[];
}

export interface ActivityLogEntry {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string;
  school_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  performed_at: string;
}

export interface ActivityLogData {
  total: number;
  limit: number;
  offset: number;
  entries: ActivityLogEntry[];
}

// ── Merged audit timeline (access ∪ write) ──

export type TimelineFacet = "access" | "write";

export interface TimelineEntry {
  id: string;
  facet: TimelineFacet;
  at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string;
  school_id: string | null;
  /** Set on write rows — the "<entity>.<verb>" action string. */
  action: string | null;
  /** Set on access rows — the record category that was read. */
  record_type: string | null;
  /** Set on write rows — the mutated entity type. */
  target_type: string | null;
  target_id: string | null;
  target_student_id: string | null;
  target_student_name: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
}

export interface TimelineSummary {
  total: number;
  distinct_actors: number;
  distinct_students: number;
  top_action: string | null;
  top_action_count: number;
  by_day: { day: string; count: number }[];
}

export interface TimelineData {
  total: number;
  limit: number;
  offset: number;
  summary: TimelineSummary;
  entries: TimelineEntry[];
}

// ── Generation observability ──

export interface GenerationJobSummary {
  id: string;
  mode: string;
  status: string;
  requested_count: number;
  produced_count: number;
  constraint: string | null;
  source_doc_count: number;
  course_id: string;
  course_name: string | null;
  unit_id: string;
  unit_name: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  llm_cost_usd: number;
  llm_call_count: number;
}

export interface GenerationJobsData {
  total: number;
  limit: number;
  offset: number;
  jobs: GenerationJobSummary[];
}

export interface GenerationItem {
  id: string;
  title: string | null;
  question: string;
  final_answer: string | null;
  solution_steps: Array<Record<string, unknown>> | null;
  difficulty: string | null;
  format: string;
  status: string;
  figure_svg: string | null;
}

export interface GenerationLLMCall {
  id: string;
  function: string;
  model: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  success: boolean;
  created_at: string;
  input_text: string | null;
  output_text: string | null;
}

export interface GenerationSourceDoc {
  id: string;
  filename: string;
  file_type: string;
}

export interface GenerationUploadedImage {
  index: number;
  media_type: string;
  image_data: string | null;
}

export interface GenerationAttachments {
  /** How many documents the teacher selected (N). */
  selected: number;
  /** How many actually reached the model after the vision-image cap (M). */
  used: number;
  /** Filenames of the documents actually sent to the model. */
  filenames: string[];
}

export interface GenerationJobDetail {
  job: GenerationJobSummary & {
    params: Record<string, unknown> | null;
    source_doc_ids: string[];
    error_message: string | null;
  };
  /** Attached-doc provenance from the generation call, or null if none. */
  attachments: GenerationAttachments | null;
  source_documents: GenerationSourceDoc[];
  uploaded_images: GenerationUploadedImage[];
  items: GenerationItem[];
  llm_calls: GenerationLLMCall[];
}

export interface DocumentContent {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  image_data: string | null;
}

