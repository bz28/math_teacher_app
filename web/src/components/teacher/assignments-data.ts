// ── Shared mock data for Assignments feature ──

export interface MockAssignment {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  type: "homework" | "quiz" | "test";
  status: "draft" | "published" | "grading" | "completed" | "scheduled";
  dueAt: string | null;
  sectionNames: string[];
  totalStudents: number;
  submitted: number;
  graded: number;
  avgScore: number | null;
  createdAt: string;
}

export interface MockSubmission {
  id: string;
  assignmentId: string;
  studentName: string;
  studentEmail: string;
  status: "submitted" | "ai_graded" | "teacher_reviewed" | "missing";
  aiScore: number | null;
  teacherScore: number | null;
  finalScore: number | null;
  submittedAt: string | null;
  aiBreakdown: { problem: string; score: number; maxScore: number; note: string; flagged: boolean }[];
  teacherNote: string;
}

export const MOCK_ASSIGNMENTS: MockAssignment[] = [
  {
    id: "a1",
    courseId: "c1",
    courseName: "Algebra I",
    title: "HW #4 — Solving Linear Equations",
    type: "homework",
    status: "grading",
    dueAt: "2026-04-05",
    sectionNames: ["Period 3", "Period 5"],
    totalStudents: 62,
    submitted: 45,
    graded: 38,
    avgScore: 78,
    createdAt: "2026-03-28",
  },
  {
    id: "a2",
    courseId: "c1",
    courseName: "Algebra I",
    title: "Unit 2 Test — Systems of Equations",
    type: "test",
    status: "scheduled",
    dueAt: "2026-04-08",
    sectionNames: ["Period 3"],
    totalStudents: 32,
    submitted: 0,
    graded: 0,
    avgScore: null,
    createdAt: "2026-04-01",
  },
  {
    id: "a3",
    courseId: "c2",
    courseName: "Chemistry",
    title: "HW #3 — Chemical Bonding",
    type: "homework",
    status: "completed",
    dueAt: "2026-03-28",
    sectionNames: ["Block A"],
    totalStudents: 45,
    submitted: 40,
    graded: 40,
    avgScore: 82,
    createdAt: "2026-03-20",
  },
  {
    id: "a4",
    courseId: "c1",
    courseName: "Algebra I",
    title: "HW #3 — Graphing Linear Functions",
    type: "homework",
    status: "completed",
    dueAt: "2026-03-21",
    sectionNames: ["Period 3", "Period 5"],
    totalStudents: 62,
    submitted: 58,
    graded: 58,
    avgScore: 74,
    createdAt: "2026-03-14",
  },
  {
    id: "a5",
    courseId: "c1",
    courseName: "Algebra I",
    title: "Chapter 1 Quiz",
    type: "quiz",
    status: "completed",
    dueAt: "2026-03-10",
    sectionNames: ["Period 3", "Period 5"],
    totalStudents: 62,
    submitted: 60,
    graded: 60,
    avgScore: 85,
    createdAt: "2026-03-05",
  },
];

export const MOCK_SUBMISSIONS: MockSubmission[] = [
  {
    id: "s1", assignmentId: "a1", studentName: "Sarah Martinez", studentEmail: "sarah@school.com",
    status: "teacher_reviewed", aiScore: 92, teacherScore: null, finalScore: 92, submittedAt: "2026-04-04T14:30:00Z",
    aiBreakdown: [
      { problem: "Q1: Solve 2x + 3 = 9", score: 10, maxScore: 10, note: "Correct. Full work shown.", flagged: false },
      { problem: "Q2: Solve 5x - 7 = 18", score: 10, maxScore: 10, note: "Correct.", flagged: false },
      { problem: "Q3: Solve 3(x + 2) = 15", score: 8, maxScore: 10, note: "Correct answer but skipped distribution step.", flagged: true },
    ],
    teacherNote: "",
  },
  {
    id: "s2", assignmentId: "a1", studentName: "Jake Thompson", studentEmail: "jake@school.com",
    status: "ai_graded", aiScore: 78, teacherScore: null, finalScore: null, submittedAt: "2026-04-04T16:15:00Z",
    aiBreakdown: [
      { problem: "Q1: Solve 2x + 3 = 9", score: 10, maxScore: 10, note: "Correct.", flagged: false },
      { problem: "Q2: Solve 5x - 7 = 18", score: 5, maxScore: 10, note: "Set up correctly but arithmetic error: 25/5 = 4 instead of 5.", flagged: true },
      { problem: "Q3: Solve 3(x + 2) = 15", score: 10, maxScore: 10, note: "Correct with all steps.", flagged: false },
    ],
    teacherNote: "",
  },
  {
    id: "s3", assignmentId: "a1", studentName: "Maria Garcia", studentEmail: "maria@school.com",
    status: "ai_graded", aiScore: 55, teacherScore: null, finalScore: null, submittedAt: "2026-04-05T08:00:00Z",
    aiBreakdown: [
      { problem: "Q1: Solve 2x + 3 = 9", score: 10, maxScore: 10, note: "Correct.", flagged: false },
      { problem: "Q2: Solve 5x - 7 = 18", score: 3, maxScore: 10, note: "Sign error when moving -7. Got x = 2.2 instead of 5.", flagged: true },
      { problem: "Q3: Solve 3(x + 2) = 15", score: 0, maxScore: 10, note: "Distribution error: wrote 3x + 2 instead of 3x + 6.", flagged: true },
    ],
    teacherNote: "",
  },
  {
    id: "s4", assignmentId: "a1", studentName: "Alex Park", studentEmail: "alex@school.com",
    status: "ai_graded", aiScore: 85, teacherScore: null, finalScore: null, submittedAt: "2026-04-04T20:00:00Z",
    aiBreakdown: [
      { problem: "Q1: Solve 2x + 3 = 9", score: 10, maxScore: 10, note: "Correct.", flagged: false },
      { problem: "Q2: Solve 5x - 7 = 18", score: 10, maxScore: 10, note: "Correct.", flagged: false },
      { problem: "Q3: Solve 3(x + 2) = 15", score: 5, maxScore: 10, note: "Correct answer but work is unclear — partial credit.", flagged: true },
    ],
    teacherNote: "",
  },
  {
    id: "s5", assignmentId: "a1", studentName: "Chris Davis", studentEmail: "chris@school.com",
    status: "missing", aiScore: null, teacherScore: null, finalScore: null, submittedAt: null,
    aiBreakdown: [],
    teacherNote: "",
  },
  {
    id: "s6", assignmentId: "a1", studentName: "Lin Wu", studentEmail: "lin@school.com",
    status: "ai_graded", aiScore: 68, teacherScore: null, finalScore: null, submittedAt: "2026-04-05T10:30:00Z",
    aiBreakdown: [
      { problem: "Q1: Solve 2x + 3 = 9", score: 10, maxScore: 10, note: "Correct.", flagged: false },
      { problem: "Q2: Solve 5x - 7 = 18", score: 8, maxScore: 10, note: "Minor error in final step, self-corrected.", flagged: false },
      { problem: "Q3: Solve 3(x + 2) = 15", score: 2, maxScore: 10, note: "Attempted but gave up halfway. Only showed first step.", flagged: true },
    ],
    teacherNote: "",
  },
];
