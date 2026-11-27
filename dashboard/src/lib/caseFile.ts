// The admin case file's two reads: GET /admin/submissions/{id}/case and
// GET /admin/blocked-submissions (api/routes/admin_submissions.py).

export interface CaseReadingLine {
  /** Raw, undelimited LaTeX — wrap before rendering. */
  latex: string;
  plain: string;
}

export interface CaseReading {
  steps: CaseReadingLine[];
  final_answer: CaseReadingLine | null;
  student_edited: boolean;
}

export interface CaseGrade {
  score_status: string;
  percent: number;
  confidence: number | null;
  reasoning: string | null;
  student_feedback: string | null;
  student_answer: string | null;
}

export interface CaseFinal {
  score_status: string;
  percent: number;
  feedback: string | null;
  differs_from_ai: boolean;
}

export type CaseCheckKind =
  | "probed" | "probed_pending" | "inconclusive" | "unfinished"
  | "diagnosed" | "blank" | "unreadable" | "diagnosis_failed";

export interface CaseIntegrityProblem {
  problem_id: string;
  kind: CaseCheckKind | string;
  status: string;
  rubric: Record<string, string> | null;
  reasoning: string | null;
  diagnosis_kind: string | null;
  diagnosis_note: string | null;
  selected_reason: string | null;
  teacher_dismissed: boolean;
  teacher_dismissal_reason: string | null;
}

export interface CaseProblem {
  position: number;
  bank_item_id: string;
  question: string;
  answer_key: string | null;
  reading: CaseReading | null;
  /** The AI's call on this problem, as a percent — including the zero it
   *  stamps on a problem it returned no grade for (which has no `grade`). */
  ai_call: number | null;
  grade: CaseGrade | null;
  final: CaseFinal | null;
  integrity: CaseIntegrityProblem | null;
}

export interface CaseTurn {
  ordinal: number;
  role: "agent" | "agent_note" | "student" | "tool_call" | "tool_result" | string;
  content: string;
  tool_name: string | null;
  tool_use_id: string | null;
  tool_input: Record<string, unknown> | null;
  seconds_on_turn: number | null;
  engagement: string | null;
  telemetry: Record<string, unknown> | null;
  created_at: string;
}

export interface CaseIntegrity {
  check_id: string;
  status: string;
  disposition: string | null;
  incomplete_reason: string | null;
  headline: string | null;
  overall_summary: string | null;
  probe_selection_reason: string | null;
  posture: string;
  tier: string;
  inline_variant_used: boolean;
  inline_variant_result: string | null;
  resolution: string;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  turns: CaseTurn[];
}

export interface CaseTimelineEvent {
  at: string;
  action: string;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CaseGradingJob {
  status: string;
  scheduled_for: string | null;
  requested_by_name: string | null;
  attempts: number;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface SubmissionCase {
  submission_id: string;
  student_id: string;
  student_name: string | null;
  assignment_id: string;
  assignment_title: string;
  extraction_confidence: number | null;
  unplaced_reading: CaseReadingLine[];
  problems: CaseProblem[];
  grade: {
    ai_score: number | null;
    final_score: number | null;
    ai_grading_status: string | null;
    graded_at: string | null;
    reviewed_at: string | null;
    grade_published_at: string | null;
    teacher_notes: string | null;
  } | null;
  integrity: CaseIntegrity | null;
  timeline: CaseTimelineEvent[];
  grading_job: CaseGradingJob | null;
}

export interface BlockedStudentRow {
  /** Null once the account is deleted. */
  student_id: string | null;
  student_name: string;
  student_email: string | null;
  assignment_id: string | null;
  assignment_title: string | null;
  course_name: string | null;
  school_id: string | null;
  attempts: number;
  first_at: string;
  last_at: string;
  largest_request_bytes: number | null;
  reasons: Record<string, number>;
  top_reason: string;
  submitted_since: boolean;
}

export interface BlockedSubmissionsData {
  days: number;
  since: string;
  students: BlockedStudentRow[];
}
