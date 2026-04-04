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

  register(data: {
    email: string;
    password: string;
    name: string;
    grade_level: number;
    invite_token?: string;
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

  createMockTest(problem: string, allProblems?: string[]) {
    return apiFetch<{ id: string }>("/session/mock-test", {
      method: "POST",
      body: JSON.stringify({ problem, all_problems: allProblems ?? [] }),
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

export interface TeacherSectionDetail {
  id: string;
  name: string;
  join_code: string | null;
  join_code_expires_at: string | null;
  students: { id: string; name: string; email: string }[];
}

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
  created_at: string;
}

export interface TeacherAssignment {
  id: string;
  course_id: string;
  unit_id: string | null;
  title: string;
  type: string;
  source_type: string | null;
  status: string;
  due_at: string | null;
  late_policy: string;
  section_names: string[];
  total_students: number;
  submitted: number;
  graded: number;
  avg_score: number | null;
  created_at: string;
}

export interface TeacherSubmission {
  id: string;
  student_name: string;
  student_email: string;
  status: string;
  submitted_at: string | null;
  is_late: boolean;
  ai_score: number | null;
  ai_breakdown: { problem: string; score: number; max_score: number; note: string; flagged: boolean }[] | null;
  teacher_score: number | null;
  teacher_notes: string | null;
  final_score: number | null;
  reviewed_at: string | null;
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
  addStudent(courseId: string, sectionId: string, email: string) {
    return apiFetch<{ status: string }>(`/teacher/courses/${courseId}/sections/${sectionId}/students`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
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
  createUnit(courseId: string, name: string) {
    return apiFetch<{ id: string; name: string; position: number }>(`/teacher/courses/${courseId}/units`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },
  updateUnit(courseId: string, unitId: string, data: { name?: string; position?: number }) {
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
    return apiFetch<TeacherAssignment & { content: unknown; answer_key: unknown }>(`/teacher/assignments/${assignmentId}`);
  },
  createAssignment(courseId: string, data: {
    title: string; type: string; source_type?: string; due_at?: string;
    late_policy?: string; content?: unknown; answer_key?: unknown; unit_id?: string;
    document_ids?: string[];
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
  assignToSections(assignmentId: string, sectionIds: string[]) {
    return apiFetch<{ status: string }>(`/teacher/assignments/${assignmentId}/sections`, {
      method: "POST",
      body: JSON.stringify({ section_ids: sectionIds }),
    });
  },
  submissions(assignmentId: string) {
    return apiFetch<{ submissions: TeacherSubmission[] }>(`/teacher/assignments/${assignmentId}/submissions`);
  },
  gradeSubmission(submissionId: string, data: { action: string; teacher_score?: number; teacher_notes?: string }) {
    return apiFetch<{ status: string }>(`/teacher/submissions/${submissionId}/grade`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
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
  suggestUnits(courseId: string, filenames: string[]) {
    return apiFetch<{ suggestions: { filename: string; suggested_unit: string; is_new: boolean; confidence: number }[] }>(
      `/teacher/courses/${courseId}/suggest-units`,
      { method: "POST", body: JSON.stringify({ filenames }) },
    );
  },
  // AI assignment generation
  generateQuestions(data: { course_id: string; unit_name: string; difficulty: string; count: number; subject?: string }) {
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
};

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
