/**
 * API client for the FastAPI backend.
 * Mirrors mobile/src/services/api.ts — same endpoints, same auth flow.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/v1";
const DEFAULT_TIMEOUT = 15_000;
const LLM_TIMEOUT = 30_000;
const SESSION_CREATE_TIMEOUT = 90_000;

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
  school_id: string | null;
  school_name: string | null;
  subscription_tier: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  is_pro: boolean;
}

export interface InviteData {
  email: string;
  school_name: string;
  school_id: string;
}

export interface SectionInviteData {
  email: string;
  section_id: string;
  section_name: string;
  course_id: string;
  course_name: string;
  school_name: string;
}

export interface EnrolledCourse {
  id: string;
  name: string;
  subject: string;
  grade_level: number | null;
  section_id: string;
  section_name: string;
  teacher_name: string;
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
  topic?: string;
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
  mode: string;
  topic: string | null;
  all_problems: string[];
}

export interface SessionHistoryResponse {
  items: SessionHistoryItem[];
  has_more: boolean;
}

export interface EntitlementLimits {
  daily_sessions_used: number;
  daily_sessions_limit: number | null;
  daily_scans_used: number;
  daily_scans_limit: number | null;
  daily_chats_used: number;
  daily_chats_limit: number | null;
}

export interface EntitlementsResponse {
  is_pro: boolean;
  subscription_tier: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  limits: EntitlementLimits;
  gated_features: string[];
}

// ── Error ──

/**
 * Shape of FastAPI error response bodies. `detail` is the standard
 * field; the other fields are populated by specific error paths
 * (e.g. entitlement gating).
 */
export interface ApiErrorBody {
  detail?: string;
  entitlement?: string;
  is_limit?: boolean;
  message?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.detail ?? `API error ${status}`);
    this.name = "ApiError";
  }
}

export class EntitlementError extends ApiError {
  public entitlement: string;
  public isLimit: boolean;

  constructor(status: number, body: ApiErrorBody) {
    super(status, body);
    this.name = "EntitlementError";
    this.entitlement = body.entitlement ?? "";
    this.isLimit = body.is_limit ?? false;
    this.message = body.message ?? "Feature requires Pro subscription";
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

// ── Preview mode token stash ──

const TEACHER_TOKEN_KEY = "veradic_teacher_access_token";
const TEACHER_REFRESH_KEY = "veradic_teacher_refresh_token";

/** Stash teacher tokens and swap to the preview student tokens. */
export function enterPreviewMode(studentTokens: TokenPair) {
  const teacherAccess = getAccessToken();
  const teacherRefresh = getRefreshToken();
  if (teacherAccess) localStorage.setItem(TEACHER_TOKEN_KEY, teacherAccess);
  if (teacherRefresh) localStorage.setItem(TEACHER_REFRESH_KEY, teacherRefresh);
  saveTokens(studentTokens);
}

/** Restore teacher tokens and clear the stash. Returns true if stash existed. */
export function exitPreviewMode(): boolean {
  const teacherAccess = localStorage.getItem(TEACHER_TOKEN_KEY);
  const teacherRefresh = localStorage.getItem(TEACHER_REFRESH_KEY);
  if (!teacherAccess || !teacherRefresh) return false;
  localStorage.setItem(TOKEN_KEY, teacherAccess);
  localStorage.setItem(REFRESH_KEY, teacherRefresh);
  localStorage.removeItem(TEACHER_TOKEN_KEY);
  localStorage.removeItem(TEACHER_REFRESH_KEY);
  return true;
}

/** Check if we're currently in preview mode (teacher tokens stashed). */
export function isInPreviewMode(): boolean {
  return !!localStorage.getItem(TEACHER_TOKEN_KEY);
}

// ── Refresh deduplication ──

let refreshPromise: Promise<boolean> | null = null;
/** Whether the last refresh failure was a definitive auth rejection (401) vs transient error */
let lastRefreshWasAuthRejection = false;

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
      if (res.status === 401) {
        lastRefreshWasAuthRejection = true;
        return false;
      }
      if (!res.ok) {
        lastRefreshWasAuthRejection = false;
        return false;
      }
      lastRefreshWasAuthRejection = false;
      const data: TokenPair = await res.json();
      saveTokens(data);
      return true;
    } catch {
      lastRefreshWasAuthRejection = false;
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
        // Only clear tokens on definitive 401 from refresh endpoint.
        // Network errors / 5xx leave tokens intact so a later retry can succeed.
        if (lastRefreshWasAuthRejection) {
          clearTokens();
        }
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

    if (res.status === 204) return undefined as T;
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

  validateInvite(token: string) {
    return apiFetch<InviteData>(`/auth/invite/${token}`);
  },

  validateSectionInvite(token: string) {
    return apiFetch<SectionInviteData>(`/auth/invite/section/${token}`);
  },

  claimSectionInvite(token: string) {
    return apiFetch<{ status: string; section_id: string }>(
      "/auth/invite/section/claim",
      { method: "POST", body: JSON.stringify({ token }) },
    );
  },

  register(data: {
    email: string;
    password: string;
    name: string;
    grade_level: number;
    invite_token?: string;
    section_invite_token?: string;
    join_code?: string;
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

  entitlements() {
    return apiFetch<EntitlementsResponse>("/auth/entitlements");
  },

  enrolledCourses() {
    return apiFetch<{ courses: EnrolledCourse[] }>("/auth/enrolled-courses");
  },

  forgotPassword(email: string) {
    return apiFetch<{ status: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  setPassword(token: string, password: string) {
    return apiFetch<{ status: string }>("/auth/set-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
  },

  deleteAccount(password: string) {
    return apiFetch<void>("/auth/account", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
  },
};

// ── Session endpoints ──

export const session = {
  create(data: {
    problem: string;
    mode: "learn" | "practice";
    subject: string;
    image_base64?: string;
    section_id?: string;
  }) {
    return apiFetch<SessionResponse>("/session", {
      method: "POST",
      body: JSON.stringify(data),
      timeout: SESSION_CREATE_TIMEOUT,
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
        timeout: SESSION_CREATE_TIMEOUT,
      },
    );
  },

  history(
    filter: { subject: string; mode?: string; topic?: string; date_from?: string; date_to?: string } | { section_id: string },
    limit = 20,
    offset = 0,
  ) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    for (const [k, v] of Object.entries(filter)) {
      if (v) params.set(k, v);
    }
    return apiFetch<SessionHistoryResponse>(`/session/history?${params}`);
  },

  historyTopics(subject: string) {
    return apiFetch<{ topics: string[] }>(`/session/history/topics?subject=${subject}`);
  },

  abandon(sessionId: string) {
    return apiFetch<{ status: string }>(`/session/${sessionId}/abandon`, {
      method: "POST",
    });
  },

  createMockTest(problem: string, allProblems?: string[], subject = "math") {
    return apiFetch<{ id: string }>("/session/mock-test", {
      method: "POST",
      body: JSON.stringify({ problem, all_problems: allProblems ?? [], subject }),
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

  createPracticeBatch(problem: string, subject = "math") {
    return apiFetch<{ id: string }>("/session/practice-batch", {
      method: "POST",
      body: JSON.stringify({ problem, subject }),
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
  generate(data: { problem?: string; problems?: string[]; count?: number; subject: string; image_base64?: string; difficulty?: string }) {
    return apiFetch<PracticeGenerateResponse>("/practice/generate", {
      method: "POST",
      body: JSON.stringify(data),
      timeout: SESSION_CREATE_TIMEOUT,
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
      timeout: SESSION_CREATE_TIMEOUT,
    });
  },
};

// ── Promo endpoints ──

export const promo = {
  redeem(code: string) {
    return apiFetch<{ status: string; message: string; expires_at: string | null }>(
      "/promo/redeem",
      { method: "POST", body: JSON.stringify({ code }) },
    );
  },
};

// ── Student endpoints ──

export const student = {
  joinSection(joinCode: string) {
    return apiFetch<{ status: string; section_id: string }>("/teacher/join", {
      method: "POST",
      body: JSON.stringify({ join_code: joinCode }),
    });
  },
};

// ── Teacher endpoints ──

export interface TeacherCourse {
  id: string;
  name: string;
  subject: string;
  grade_level: number | null;
  description: string | null;
  status: string;
  section_count: number;
  doc_count: number;
  created_at: string;
}

export interface TeacherSection {
  id: string;
  name: string;
  student_count: number;
  join_code: string | null;
  join_code_expires_at: string | null;
}

export interface TeacherSectionInvite {
  id: string;
  email: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export interface TeacherSectionDetail {
  id: string;
  name: string;
  join_code: string | null;
  join_code_expires_at: string | null;
  students: { id: string; name: string; email: string }[];
  pending_invites: TeacherSectionInvite[];
}

export type InviteStudentResult =
  | { status: "enrolled"; student_id: string }
  | { status: "invited"; invite: TeacherSectionInvite };

export interface TeacherDocument {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  unit_id: string | null;
  created_at: string;
}

export interface TeacherUnit {
  id: string;
  name: string;
  position: number;
  parent_id: string | null;
  created_at: string;
}

export interface TeacherAssignment {
  id: string;
  course_id: string;
  unit_ids: string[];
  title: string;
  type: string;
  source_type: string | null;
  status: string;
  due_at: string | null;
  late_policy: string;
  section_ids: string[];
  section_names: string[];
  /** Number of problems in this assignment, cheaply derived from
   *  content.problem_ids on the backend. */
  problem_count: number;
  total_students: number;
  submitted: number;
  graded: number;
  avg_score: number | null;
  created_at: string;
}

/** Structured grading rubric. All fields optional — teachers fill in
 *  what makes sense for the HW. Consumed by the AI grader in a follow-
 *  up PR; in v1 it's a reference panel during manual grading. */
export type GradingMode =
  | "answer_only"
  | "answer_and_work"
  | "method_focused"
  | "custom";

export interface TeacherRubric {
  grading_mode?: GradingMode;
  full_credit?: string;
  partial_credit?: string;
  common_mistakes?: string;
  notes?: string;
}

/** Per-problem grade row. Shape matches the SubmissionGrade.breakdown
 *  JSON persisted by the grade endpoint — `score_status` drives the
 *  Full/Partial/Zero pill; `percent` is the committed numeric value. */
export interface GradeBreakdownEntry {
  problem_id: string;
  score_status: "full" | "partial" | "zero";
  percent: number;
  feedback: string | null;
}

/** One row per (published HW × section) pair in the Submissions tab
 *  inbox feed. Aggregates computed server-side so the tab renders
 *  with a single GET. */
export interface SubmissionsInboxRow {
  assignment_id: string;
  assignment_title: string;
  section_id: string;
  section_name: string;
  due_at: string | null;
  total_students: number;
  submitted: number;
  /** Submissions whose integrity check flagged them
   *  (uncertain / unlikely / unreadable). */
  flagged: number;
  /** Graded but not yet published to students. */
  to_grade: number;
  /** Already published, but the teacher has edited the grade since.
   *  Students still see the old published snapshot — teacher must
   *  republish to ship the edits. Folded into the "to release" pill. */
  dirty: number;
  /** Published — students can see these grades. */
  published: number;
}

/** One row per (student × section enrollment) in the Grades tab roster.
 *  Counts are scoped to assigned+past-due HWs; avg excludes missing. */
export interface GradesRosterRow {
  student_id: string;
  name: string;
  section_id: string;
  section_name: string;
  assigned_count: number;
  graded_count: number;
  missing_count: number;
  /** Mean of published final_scores across assigned HWs. Null if
   *  the student has no published grades yet. */
  avg_percent: number | null;
}

/** Response from the Grades tab roster endpoint. `sections` drives
 *  the filter dropdown (always the full set for the course). */
export interface GradesRosterResponse {
  sections: { id: string; name: string }[];
  students: GradesRosterRow[];
}

/** One HW row on the student detail page. Covers both graded
 *  (final_score set) and still-being-graded (final_score null) HWs —
 *  the detail page shows every published HW assigned to the section
 *  so nothing disappears while the teacher is mid-grading. */
export interface StudentGradePublishedHw {
  assignment_id: string;
  title: string;
  due_at: string | null;
  graded_at: string | null;
  /** Null when the grade hasn't been published yet — row renders as
   *  "Not graded yet" instead of a score. */
  final_score: number | null;
  teacher_notes: string | null;
  /** Included so the detail page can link into the review page. */
  section_id: string;
}

/** One missing HW row (past due, no submission from this student). */
export interface StudentGradeMissingHw {
  assignment_id: string;
  title: string;
  due_at: string | null;
}

/** Full published-grade record for one student in one section. */
export interface StudentGradesResponse {
  student: {
    id: string;
    name: string;
    section_id: string;
    section_name: string;
  };
  overall_avg: number | null;
  class_avg: number | null;
  graded_count: number;
  missing_count: number;
  published_hws: StudentGradePublishedHw[];
  missing_hws: StudentGradeMissingHw[];
}

export const teacher = {
  courses() {
    return apiFetch<{ courses: TeacherCourse[] }>("/teacher/courses");
  },
  course(id: string) {
    return apiFetch<TeacherCourse>(`/teacher/courses/${id}`);
  },
  createCourse(data: { name: string; subject?: string; grade_level?: number; description?: string }) {
    return apiFetch<{ id: string }>("/teacher/courses", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  updateCourse(id: string, data: Record<string, unknown>) {
    return apiFetch<{ status: string }>(`/teacher/courses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },
  deleteCourse(id: string) {
    return apiFetch<{ status: string }>(`/teacher/courses/${id}`, { method: "DELETE" });
  },
  sections(courseId: string) {
    return apiFetch<{ sections: TeacherSection[] }>(`/teacher/courses/${courseId}/sections`);
  },
  section(courseId: string, sectionId: string) {
    return apiFetch<TeacherSectionDetail>(`/teacher/courses/${courseId}/sections/${sectionId}`);
  },
  createSection(courseId: string, name: string) {
    return apiFetch<{ id: string }>(`/teacher/courses/${courseId}/sections`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },
  deleteSection(courseId: string, sectionId: string) {
    return apiFetch<{ status: string }>(`/teacher/courses/${courseId}/sections/${sectionId}`, { method: "DELETE" });
  },
  inviteStudent(courseId: string, sectionId: string, email: string) {
    return apiFetch<InviteStudentResult>(
      `/teacher/courses/${courseId}/sections/${sectionId}/invites`,
      { method: "POST", body: JSON.stringify({ email }) },
    );
  },
  resendInvite(courseId: string, sectionId: string, inviteId: string) {
    return apiFetch<{ status: string; invite: TeacherSectionInvite }>(
      `/teacher/courses/${courseId}/sections/${sectionId}/invites/${inviteId}/resend`,
      { method: "POST" },
    );
  },
  revokeInvite(courseId: string, sectionId: string, inviteId: string) {
    return apiFetch<{ status: string }>(
      `/teacher/courses/${courseId}/sections/${sectionId}/invites/${inviteId}`,
      { method: "DELETE" },
    );
  },
  removeStudent(courseId: string, sectionId: string, studentId: string) {
    return apiFetch<{ status: string }>(`/teacher/courses/${courseId}/sections/${sectionId}/students/${studentId}`, { method: "DELETE" });
  },
  generateJoinCode(courseId: string, sectionId: string) {
    return apiFetch<{ join_code: string }>(`/teacher/courses/${courseId}/sections/${sectionId}/join-code`, { method: "POST" });
  },
  documents(courseId: string) {
    return apiFetch<{ documents: TeacherDocument[] }>(`/teacher/courses/${courseId}/documents`);
  },
  document(courseId: string, docId: string) {
    return apiFetch<{
      id: string;
      filename: string;
      file_type: string;
      file_size: number;
      image_data: string | null;
      created_at: string;
    }>(`/teacher/courses/${courseId}/documents/${docId}`);
  },
  uploadDocument(courseId: string, data: { image_base64: string; filename: string; unit_id?: string | null }) {
    return apiFetch<{ id: string }>(`/teacher/courses/${courseId}/documents`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  updateDocument(courseId: string, docId: string, data: { unit_id: string | null }) {
    return apiFetch<{ status: string }>(`/teacher/courses/${courseId}/documents/${docId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },
  deleteDocument(courseId: string, docId: string) {
    return apiFetch<{ status: string }>(`/teacher/courses/${courseId}/documents/${docId}`, { method: "DELETE" });
  },
  // Units
  units(courseId: string) {
    return apiFetch<{ units: TeacherUnit[] }>(`/teacher/courses/${courseId}/units`);
  },
  createUnit(courseId: string, data: { name: string; parent_id?: string | null }) {
    return apiFetch<{ id: string; name: string; position: number; parent_id: string | null }>(
      `/teacher/courses/${courseId}/units`,
      { method: "POST", body: JSON.stringify(data) },
    );
  },
  updateUnit(
    courseId: string,
    unitId: string,
    data: { name?: string; position?: number; parent_id?: string | null; clear_parent?: boolean },
  ) {
    return apiFetch<{ status: string }>(`/teacher/courses/${courseId}/units/${unitId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },
  deleteUnit(courseId: string, unitId: string) {
    return apiFetch<{ status: string }>(`/teacher/courses/${courseId}/units/${unitId}`, { method: "DELETE" });
  },
  // Assignments
  assignments(courseId: string) {
    return apiFetch<{ assignments: TeacherAssignment[] }>(`/teacher/courses/${courseId}/assignments`);
  },
  allAssignments() {
    return apiFetch<{ assignments: TeacherAssignment[] }>("/teacher/assignments");
  },
  assignment(assignmentId: string) {
    return apiFetch<TeacherAssignment & {
      content: unknown;
      answer_key: unknown;
      rubric: TeacherRubric | null;
    }>(`/teacher/assignments/${assignmentId}`);
  },
  createAssignment(courseId: string, data: {
    title: string; type: string; source_type?: string; due_at?: string;
    late_policy?: string; content?: unknown; answer_key?: unknown;
    /** Required: at least one unit. Multi-unit is for midterms / review HWs. */
    unit_ids: string[];
    document_ids?: string[]; bank_item_ids?: string[];
  }) {
    return apiFetch<{ id: string; title: string; status: string }>(`/teacher/courses/${courseId}/assignments`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  updateAssignment(assignmentId: string, data: Record<string, unknown>) {
    return apiFetch<{ status: string }>(`/teacher/assignments/${assignmentId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },
  deleteAssignment(assignmentId: string) {
    return apiFetch<{ status: string }>(`/teacher/assignments/${assignmentId}`, { method: "DELETE" });
  },
  publishAssignment(assignmentId: string) {
    return apiFetch<{ status: string }>(`/teacher/assignments/${assignmentId}/publish`, { method: "POST" });
  },
  unpublishAssignment(assignmentId: string) {
    return apiFetch<{ status: string }>(`/teacher/assignments/${assignmentId}/unpublish`, { method: "POST" });
  },
  assignToSections(assignmentId: string, sectionIds: string[]) {
    return apiFetch<{ status: string }>(`/teacher/assignments/${assignmentId}/sections`, {
      method: "POST",
      body: JSON.stringify({ section_ids: sectionIds }),
    });
  },
  submissions(assignmentId: string) {
    return apiFetch<{ submissions: TeacherSubmissionRow[] }>(`/teacher/assignments/${assignmentId}/submissions`);
  },
  /** Inbox feed for the Submissions tab — one row per (published
   *  HW × section) pair with aggregate counts. See backend comment
   *  for the shape. */
  submissionsInbox(courseId: string) {
    return apiFetch<{ rows: SubmissionsInboxRow[] }>(
      `/teacher/courses/${courseId}/submissions-inbox`,
    );
  },
  /** Grades tab roster — one row per (student × section). Only
   *  counts HWs that are published, assigned, and past due. */
  gradesRoster(courseId: string, sectionId?: string) {
    const qs = sectionId ? `?section_id=${sectionId}` : "";
    return apiFetch<GradesRosterResponse>(
      `/teacher/courses/${courseId}/grades${qs}`,
    );
  },
  /** Full published-grade record for one student in one section. */
  studentGrades(courseId: string, sectionId: string, studentId: string) {
    return apiFetch<StudentGradesResponse>(
      `/teacher/courses/${courseId}/sections/${sectionId}/students/${studentId}/grades`,
    );
  },
  /** Replace the per-problem breakdown (and/or teacher notes) for a
   *  submission. Full replacement semantics — send every entry on
   *  each call. Returns the recomputed overall `final_score`. */
  gradeSubmission(
    submissionId: string,
    data: { breakdown?: GradeBreakdownEntry[]; teacher_notes?: string },
  ) {
    return apiFetch<{
      status: string;
      final_score: number | null;
      grade_published_at: string | null;
      grade_dirty: boolean;
    }>(`/teacher/submissions/${submissionId}/grade`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },
  /** Publish every graded submission on this HW to students at once.
   *  Idempotent — already-published grades are skipped, and ungraded
   *  submissions are ignored (teacher can grade + publish more later).
   *  Returns the count actually published. */
  publishGrades(assignmentId: string) {
    return apiFetch<{ status: string; published_count: number }>(
      `/teacher/assignments/${assignmentId}/publish-grades`,
      { method: "POST" },
    );
  },
  // Visibility
  getVisibility(courseId: string) {
    return apiFetch<{ hidden_units: Record<string, string[]>; hidden_docs: Record<string, string[]> }>(
      `/teacher/courses/${courseId}/visibility`,
    );
  },
  toggleVisibility(courseId: string, data: { section_id: string; target_type: string; target_id: string }) {
    return apiFetch<{ is_hidden: boolean }>(`/teacher/courses/${courseId}/visibility/toggle`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  // AI suggestions
  suggestUnits(courseId: string, filenames: string[], documentIds?: string[]) {
    return apiFetch<{ suggestions: { filename: string; suggested_unit: string; is_new: boolean; confidence: number }[] }>(
      `/teacher/courses/${courseId}/suggest-units`,
      { method: "POST", body: JSON.stringify({ filenames, document_ids: documentIds }), timeout: 120_000 },
    );
  },
  // AI assignment generation
  generateQuestions(data: { course_id: string; unit_name: string; difficulty: string; count: number; subject?: string; document_ids?: string[] }) {
    return apiFetch<{ questions: { text: string; difficulty: string }[] }>(
      "/teacher/assignments/generate-questions",
      { method: "POST", body: JSON.stringify(data), timeout: 60_000 },
    );
  },
  generateSolutions(data: { questions: { text: string; difficulty: string }[]; subject?: string }) {
    return apiFetch<{ solutions: { question_text: string; steps: { title: string; description: string }[]; final_answer: string }[] }>(
      "/teacher/assignments/generate-solutions",
      { method: "POST", body: JSON.stringify(data), timeout: 90_000 },
    );
  },
  // ── Question bank ──
  bank(
    courseId: string,
    filters?: {
      status?: string;
      unit_id?: string;
      /** Scope to questions generated from a specific homework. Used
       *  by the HW detail banner so two HWs in the same unit don't
       *  share their pending pool. */
      assignment_id?: string;
      difficulty?: string;
      parent_question_id?: string;
    },
  ) {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status_filter", filters.status);
    if (filters?.unit_id) params.set("unit_id", filters.unit_id);
    if (filters?.assignment_id) params.set("assignment_id", filters.assignment_id);
    if (filters?.difficulty) params.set("difficulty", filters.difficulty);
    if (filters?.parent_question_id)
      params.set("parent_question_id", filters.parent_question_id);
    const qs = params.toString();
    return apiFetch<{ items: BankItem[]; counts: BankCounts }>(
      `/teacher/courses/${courseId}/question-bank${qs ? `?${qs}` : ""}`,
    );
  },
  generateBank(courseId: string, data: {
    count: number;
    /** The HW the teacher is on — every item produced gets stamped
     *  with this so it knows which homework it belongs to. */
    assignment_id: string;
    unit_id?: string | null;
    document_ids?: string[];
    constraint?: string | null;
  }) {
    return apiFetch<BankJob>(`/teacher/courses/${courseId}/question-bank/generate`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  uploadWorksheet(courseId: string, data: {
    images: string[];
    assignment_id: string;
    unit_id?: string | null;
  }) {
    return apiFetch<BankJob>(`/teacher/courses/${courseId}/question-bank/upload`, {
      method: "POST",
      body: JSON.stringify(data),
      timeout: 30_000,
    });
  },
  bankJob(courseId: string, jobId: string) {
    return apiFetch<BankJob>(`/teacher/courses/${courseId}/question-bank/generation-jobs/${jobId}`);
  },
  updateBankItem(itemId: string, data: {
    title?: string;
    question?: string;
    solution_steps?: { title: string; description: string }[];
    final_answer?: string;
    difficulty?: string;
    unit_id?: string | null;
    clear_unit?: boolean;
  }) {
    return apiFetch<BankItem>(`/teacher/question-bank/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },
  revertBankItem(itemId: string) {
    return apiFetch<BankItem>(`/teacher/question-bank/${itemId}/revert`, { method: "POST" });
  },
  approveBankItem(itemId: string, options?: { assignmentId?: string }) {
    return apiFetch<{ status: string }>(`/teacher/question-bank/${itemId}/approve`, {
      method: "POST",
      body: JSON.stringify({ assignment_id: options?.assignmentId ?? null }),
    });
  },
  rejectBankItem(itemId: string) {
    return apiFetch<{ status: string }>(`/teacher/question-bank/${itemId}/reject`, { method: "POST" });
  },
  generateSimilarBank(itemId: string, data: { count: number; constraint?: string | null }) {
    return apiFetch<BankJob>(`/teacher/question-bank/${itemId}/generate-similar`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  regenerateBankItem(itemId: string, instructions?: string) {
    return apiFetch<BankItem>(`/teacher/question-bank/${itemId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ instructions: instructions ?? null }),
      timeout: 120_000,
    });
  },
  deleteBankItem(itemId: string) {
    return apiFetch<{ status: string }>(`/teacher/question-bank/${itemId}`, { method: "DELETE" });
  },
  sendBankChat(itemId: string, message: string) {
    return apiFetch<BankItem>(`/teacher/question-bank/${itemId}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
      timeout: 120_000,
    });
  },
  acceptBankChatProposal(itemId: string, messageIndex: number) {
    return apiFetch<BankItem>(`/teacher/question-bank/${itemId}/chat/accept`, {
      method: "POST",
      body: JSON.stringify({ message_index: messageIndex }),
    });
  },
  discardBankChatProposal(itemId: string, messageIndex: number) {
    return apiFetch<BankItem>(`/teacher/question-bank/${itemId}/chat/discard`, {
      method: "POST",
      body: JSON.stringify({ message_index: messageIndex }),
    });
  },
  clearBankChat(itemId: string) {
    return apiFetch<BankItem>(`/teacher/question-bank/${itemId}/chat/clear`, { method: "POST" });
  },
  // ── Submissions ──
  submissionDetail(submissionId: string) {
    return apiFetch<TeacherSubmissionDetail>(`/teacher/submissions/${submissionId}`);
  },
  integrityDetail(submissionId: string) {
    return apiFetch<TeacherIntegrityDetail>(`/teacher/integrity/submissions/${submissionId}`);
  },
  dismissIntegrityProblem(submissionId: string, problemId: string, reason: string) {
    return apiFetch<void>(`/teacher/integrity/submissions/${submissionId}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ problem_id: problemId, reason }),
    });
  },
  /** Create or reuse a shadow student, return its JWT pair. */
  previewAsStudent() {
    return apiFetch<TokenPair>("/teacher/preview-student", { method: "POST" });
  },
};

export interface IntegrityOverview {
  overall_status: "complete" | "in_progress";
  overall_badge: IntegrityBadge | null;
  problem_count: number;
  complete_count: number;
}

export interface TeacherSubmissionRow {
  id: string;
  section_id: string;
  student_id: string;
  student_name: string;
  student_email: string;
  is_preview: boolean;
  status: string;
  submitted_at: string | null;
  is_late: boolean;
  ai_score: number | null;
  ai_breakdown: unknown;
  teacher_score: number | null;
  teacher_notes: string | null;
  final_score: number | null;
  /** Per-problem grade breakdown; null until the teacher has saved
   *  grades. Future AI PR pre-fills this too. */
  breakdown: GradeBreakdownEntry[] | null;
  grade_published_at: string | null;
  /** True if the grade has been published AND edited since. Students
   *  still see the published snapshot — teacher must republish. */
  grade_dirty: boolean;
  reviewed_at: string | null;
  integrity_overview: IntegrityOverview | null;
}

export interface TeacherSubmissionDetailProblem {
  bank_item_id: string;
  position: number;
  question: string;
  final_answer: string | null;
  student_answer: string | null;
}

export interface TeacherSubmissionDetail {
  submission_id: string;
  assignment_id: string;
  assignment_title: string;
  student_id: string;
  student_name: string;
  student_email: string;
  submitted_at: string;
  is_late: boolean;
  image_data: string | null;
  problems: TeacherSubmissionDetailProblem[];
  breakdown: GradeBreakdownEntry[] | null;
  ai_breakdown: AiGradeEntry[] | null;
  final_score: number | null;
  teacher_notes: string | null;
  grade_published_at: string | null;
  /** True if the grade has been published AND edited since. Students
   *  still see the published snapshot — teacher must republish. */
  grade_dirty: boolean;
}

export interface AiGradeEntry {
  problem_position: number;
  student_answer: string;
  score_status: "full" | "partial" | "zero";
  percent: number;
  reasoning: string;
}

export interface BankChatProposal {
  question: string | null;
  solution_steps: { title: string; description: string }[] | null;
  final_answer: string | null;
}

export interface BankChatMessage {
  role: "ai" | "teacher";
  text: string;
  ts: string;
  proposal?: BankChatProposal;
  accepted?: boolean;
  discarded?: boolean;
  superseded?: boolean;
}

export interface BankItem {
  id: string;
  course_id: string;
  unit_id: string | null;
  title: string;
  question: string;
  solution_steps: { title: string; description: string }[] | null;
  final_answer: string | null;
  difficulty: string;
  status: string;
  locked: boolean;
  source: string;
  parent_question_id: string | null;
  used_in: {
    id: string;
    title: string;
    type: string;
    status: string;
    /** Units the assignment is in. May be empty for legacy data. */
    unit_ids: string[];
  }[];
  source_doc_ids: string[] | null;
  generation_prompt: string | null;
  has_previous_version: boolean;
  chat_messages: BankChatMessage[];
  chat_soft_cap: number;
  created_at: string;
  updated_at: string;
}

export interface BankCounts {
  pending: number;
  approved: number;
  rejected: number;
  archived: number;
}

export interface BankJob {
  id: string;
  course_id: string;
  unit_id: string | null;
  mode: "generate" | "upload";
  status: "queued" | "running" | "done" | "failed";
  requested_count: number;
  difficulty: string;
  constraint: string | null;
  produced_count: number;
  error_message: string | null;
  // Set when this is a "generate similar" job — children inherit
  // this as their parent_question_id, building the variation tree.
  parent_question_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── School student endpoints ──
//
// All routes are mounted at /v1/school/student. The shape mirrors the
// pydantic models in api/routes/school_student_practice.py — keep in
// sync if you change one.

export interface StudentClassSummary {
  section_id: string;
  section_name: string;
  course_id: string;
  course_name: string;
  course_subject: string;
}

export interface StudentHomeworkSummary {
  assignment_id: string;
  title: string;
  type: string;
  due_at: string | null;
  problem_count: number;
  /** "not_started" | "submitted". Drives the badge on the HW list. */
  status: string;
}

export interface StudentHomeworkProblem {
  bank_item_id: string;
  position: number;
  question: string;
  // final_answer is intentionally omitted: the HW primary is locked
  // and the student must not be able to read the answer client-side.
  difficulty: string;
  approved_variation_count: number;
}

export interface StudentHomeworkDetail {
  assignment_id: string;
  title: string;
  type: string;
  due_at: string | null;
  course_id: string;
  course_name: string;
  problems: StudentHomeworkProblem[];
  submitted: boolean;
  submission_id: string | null;
  /** ISO timestamp — null before submission. */
  submitted_at: string | null;
  /** Percent 0-100, or null if no grade published yet. */
  final_score: number | null;
  /** ISO timestamp — null until teacher publishes. */
  grade_published_at: string | null;
}

export interface StudentSubmission {
  submission_id: string;
  submitted_at: string;
  is_late: boolean;
  image_data: string | null;
  final_answers: Record<string, string>;
}

export interface SubmitHomeworkResponse {
  submission_id: string;
  submitted_at: string;
  is_late: boolean;
}

export interface VariationPayload {
  bank_item_id: string;
  question: string;
  final_answer: string | null;
  distractors: string[];
  solution_steps: { title?: string; description?: string }[] | null;
  difficulty: string;
}

export type NextVariationResponse =
  | { status: "served"; variation: VariationPayload; consumption_id: string; anchor_bank_item_id: string; remaining: number }
  | { status: "exhausted"; seen: number }
  | { status: "empty" };

export interface FlaggedConsumption {
  consumption_id: string;
  variation: VariationPayload;
  served_at: string;
}

// ── Student dashboard + grades (mirror api/routes/school_student_practice.py) ──

export interface DashboardAssignment {
  assignment_id: string;
  title: string;
  type: string;
  due_at: string | null;
  course_id: string;
  course_name: string;
  section_name: string;
  status: "not_started" | "submitted";
  is_late: boolean;
}

export interface DashboardGrade {
  assignment_id: string;
  title: string;
  course_id: string;
  course_name: string;
  section_name: string;
  /** Percent 0-100. Render with shared PercentBadge. */
  final_score: number;
  published_at: string;
}

export interface StudentDashboardResponse {
  first_name: string;
  due_this_week: DashboardAssignment[];
  overdue: DashboardAssignment[];
  in_review: DashboardAssignment[];
  recently_graded: DashboardGrade[];
}

export interface StudentGradesResponse {
  grades: DashboardGrade[];
}

export const schoolStudent = {
  listClasses() {
    return apiFetch<StudentClassSummary[]>("/school/student/classes");
  },
  getDashboard() {
    return apiFetch<StudentDashboardResponse>("/school/student/dashboard");
  },
  getAllGrades() {
    return apiFetch<StudentGradesResponse>("/school/student/grades");
  },
  listHomework(courseId: string) {
    return apiFetch<StudentHomeworkSummary[]>(`/school/student/courses/${courseId}/homework`);
  },
  homeworkDetail(assignmentId: string) {
    return apiFetch<StudentHomeworkDetail>(`/school/student/homework/${assignmentId}`);
  },
  nextVariation(assignmentId: string, bankItemId: string, mode: "practice" | "learn") {
    return apiFetch<NextVariationResponse>(
      `/school/student/homework/${assignmentId}/problems/${bankItemId}/next-variation?mode=${mode}`,
      { method: "POST" },
    );
  },
  completeConsumption(consumptionId: string) {
    return apiFetch<void>(`/school/student/bank-consumption/${consumptionId}/complete`, {
      method: "POST",
    });
  },
  flagConsumption(consumptionId: string, flagged: boolean) {
    return apiFetch<void>(`/school/student/bank-consumption/${consumptionId}/flag`, {
      method: "POST",
      body: JSON.stringify({ flagged }),
    });
  },
  flaggedConsumptions(assignmentId: string, bankItemId: string) {
    return apiFetch<FlaggedConsumption[]>(
      `/school/student/homework/${assignmentId}/problems/${bankItemId}/flagged`,
    );
  },
  submitHomework(
    assignmentId: string,
    body: { image_base64: string },
  ) {
    return apiFetch<SubmitHomeworkResponse>(`/school/student/homework/${assignmentId}/submit`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  getMySubmission(assignmentId: string) {
    return apiFetch<StudentSubmission>(`/school/student/homework/${assignmentId}/submission`);
  },
  // ── Integrity check ──
  // The conversational understanding-check. A single /turn endpoint
  // replaces the old /next + /answer pair.
  getIntegrityState(submissionId: string) {
    return apiFetch<IntegrityStateResponse>(
      `/school/student/integrity/submissions/${submissionId}`,
    );
  },
  postIntegrityTurn(
    submissionId: string,
    body: { message: string; seconds_on_turn?: number },
  ) {
    return apiFetch<IntegrityStateResponse>(
      `/school/student/integrity/submissions/${submissionId}/turn`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  flagIntegrityExtraction(submissionId: string) {
    return apiFetch<IntegrityStateResponse>(
      `/school/student/integrity/submissions/${submissionId}/flag-extraction`,
      { method: "POST" },
    );
  },
  // ── Learn-mode chat + Practice→Learn pivot ──
  stepChat(
    bankItemId: string,
    body: { step_index: number; question: string; prior_messages: SchoolChatMessage[] },
  ) {
    return apiFetch<{ reply: string }>(
      `/school/student/bank-item/${bankItemId}/step-chat`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  problemChat(
    bankItemId: string,
    body: { question: string; prior_messages: SchoolChatMessage[] },
  ) {
    return apiFetch<{ reply: string }>(
      `/school/student/bank-item/${bankItemId}/problem-chat`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  learnThisProblem(body: { bank_item_id: string; assignment_id: string }) {
    return apiFetch<Extract<NextVariationResponse, { status: "served" }>>(
      `/school/student/bank-consumption/learn-this`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
};

export interface SchoolChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Integrity check types (mirror api/routes/integrity_check.py) ──

export type IntegrityBadge = "likely" | "uncertain" | "unlikely" | "unreadable";

export type IntegrityOverallStatus =
  | "no_check"           // HW has integrity checks disabled
  | "extracting"         // pipeline is still running Vision extraction
  | "awaiting_student"   // opening agent turn written, student hasn't engaged yet
  | "in_progress"        // student has sent >=1 message, check not yet complete
  | "complete"           // agent finished (or was force-finalized)
  | "skipped_unreadable"; // extraction confidence too low, no chat

export type IntegrityProblemStatus =
  | "pending"
  | "verdict_submitted"
  | "dismissed"
  | "skipped_unreadable";

export interface IntegrityProblemSummary {
  problem_id: string;
  sample_position: number;
  status: IntegrityProblemStatus;
  badge: IntegrityBadge | null;
}

export type IntegrityTurnRole = "agent" | "student";

export interface IntegrityTurn {
  ordinal: number;
  role: IntegrityTurnRole;
  content: string;
  created_at: string;
}

export interface IntegrityStateResponse {
  submission_id: string;
  overall_status: IntegrityOverallStatus;
  overall_badge: IntegrityBadge | null;
  student_flagged_extraction: boolean;
  /** Vision extraction of the student's own work. Null when no check
   *  has started yet (pipeline still extracting or integrity disabled). */
  extraction: IntegrityExtraction | null;
  problems: IntegrityProblemSummary[];
  transcript: IntegrityTurn[];
}

// ── Teacher integrity detail (mirror api/routes/integrity_check.py) ──

export type TeacherIntegrityTurnRole =
  | "agent"
  | "student"
  | "tool_call"
  | "tool_result";

export interface TeacherIntegrityTranscriptTurn {
  ordinal: number;
  role: TeacherIntegrityTurnRole;
  content: string;
  tool_name: string | null;
  seconds_on_turn: number | null;
  created_at: string;
}

export interface IntegrityExtractionStep {
  step_num: number;
  latex: string;
  plain_english: string;
}

export interface IntegrityExtraction {
  steps: IntegrityExtractionStep[];
  confidence: number;
}

export interface TeacherIntegrityProblemRow {
  problem_id: string;
  bank_item_id: string;
  question: string;
  sample_position: number;
  status: IntegrityProblemStatus;
  badge: IntegrityBadge | null;
  confidence: number | null;
  ai_reasoning: string | null;
  teacher_dismissed: boolean;
  teacher_dismissal_reason: string | null;
  student_work_extraction: IntegrityExtraction | null;
}

export interface TeacherIntegrityDetail {
  submission_id: string;
  overall_status: string;
  overall_badge: IntegrityBadge | null;
  overall_confidence: number | null;
  overall_summary: string | null;
  student_flagged_extraction: boolean;
  problems: TeacherIntegrityProblemRow[];
  transcript: TeacherIntegrityTranscriptTurn[];
}

// ── Contact endpoints ──

export const contact = {
  submitLead(data: {
    school_name: string;
    contact_name: string;
    contact_email: string;
    role: string;
    approx_students?: number;
    message?: string;
  }) {
    return apiFetch<{ status: string; message: string }>("/contact/lead", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
};
