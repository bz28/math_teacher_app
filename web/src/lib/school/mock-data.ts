// Mock data for the new school/teacher experience (Phase 1 — UI shell only).
// Delete this file when the real backend lands in Phase 2.

export type MockCourse = {
  id: string;
  name: string;
  subject: "math" | "physics" | "chemistry";
  grade_level: string;
  description?: string;
  section_count: number;
  student_count: number;
  bank_approved: number;
  bank_pending: number;
  pending_grading: number;
  status: "draft" | "active" | "archived";
};

export type MockSection = {
  id: string;
  course_id: string;
  name: string;
  student_count: number;
  join_code: string;
};

export type MockUnit = {
  id: string;
  course_id: string;
  name: string;
  parent_id: string | null;
  doc_count: number;
};

export type MockBankQuestion = {
  id: string;
  course_id: string;
  unit_id: string;
  question: string;
  difficulty: "easy" | "medium" | "hard";
  source_doc: string;
  status: "pending" | "approved" | "rejected";
};

export type MockAssignment = {
  id: string;
  course_id: string;
  type: "homework" | "test";
  title: string;
  due_at: string;
  section_names: string[];
  status: "draft" | "published" | "grading" | "completed";
  submitted: number;
  total: number;
};

export const mockCourses: MockCourse[] = [
  {
    id: "algebra-1",
    name: "Algebra 1",
    subject: "math",
    grade_level: "9th",
    description: "Foundations of algebra — equations, functions, polynomials.",
    section_count: 3,
    student_count: 84,
    bank_approved: 132,
    bank_pending: 18,
    pending_grading: 12,
    status: "active",
  },
  {
    id: "geometry",
    name: "Geometry",
    subject: "math",
    grade_level: "10th",
    section_count: 2,
    student_count: 57,
    bank_approved: 64,
    bank_pending: 0,
    pending_grading: 0,
    status: "active",
  },
  {
    id: "ap-physics",
    name: "AP Physics 1",
    subject: "physics",
    grade_level: "11th",
    description: "College Board AP Physics 1 curriculum.",
    section_count: 1,
    student_count: 22,
    bank_approved: 41,
    bank_pending: 9,
    pending_grading: 4,
    status: "active",
  },
  {
    id: "honors-chem",
    name: "Honors Chemistry",
    subject: "chemistry",
    grade_level: "10th",
    section_count: 2,
    student_count: 48,
    bank_approved: 7,
    bank_pending: 23,
    pending_grading: 0,
    status: "active",
  },
  {
    id: "precalc",
    name: "Pre-Calculus",
    subject: "math",
    grade_level: "11th",
    section_count: 1,
    student_count: 18,
    bank_approved: 0,
    bank_pending: 0,
    pending_grading: 0,
    status: "draft",
  },
  {
    id: "intro-physics",
    name: "Intro to Physics (last year)",
    subject: "physics",
    grade_level: "9th",
    section_count: 0,
    student_count: 0,
    bank_approved: 89,
    bank_pending: 0,
    pending_grading: 0,
    status: "archived",
  },
];

export const mockSections: MockSection[] = [
  { id: "alg1-p1", course_id: "algebra-1", name: "Period 1", student_count: 28, join_code: "4F8K2X" },
  { id: "alg1-p3", course_id: "algebra-1", name: "Period 3", student_count: 31, join_code: "9MR7QH" },
  { id: "alg1-p5", course_id: "algebra-1", name: "Period 5", student_count: 25, join_code: "L2NW8B" },
];

export const mockUnits: MockUnit[] = [
  { id: "u1", course_id: "algebra-1", name: "Unit 1: Linear Equations", parent_id: null, doc_count: 4 },
  { id: "u1-notes", course_id: "algebra-1", name: "Notes", parent_id: "u1", doc_count: 2 },
  { id: "u1-ws", course_id: "algebra-1", name: "Worksheets", parent_id: "u1", doc_count: 2 },
  { id: "u2", course_id: "algebra-1", name: "Unit 2: Inequalities", parent_id: null, doc_count: 3 },
  { id: "u3", course_id: "algebra-1", name: "Unit 3: Functions", parent_id: null, doc_count: 5 },
  { id: "u4", course_id: "algebra-1", name: "Unit 4: Factoring", parent_id: null, doc_count: 6 },
  { id: "u5", course_id: "algebra-1", name: "Unit 5: Quadratics", parent_id: null, doc_count: 7 },
  { id: "u5-ex", course_id: "algebra-1", name: "Examples", parent_id: "u5", doc_count: 3 },
  { id: "u5-pr", course_id: "algebra-1", name: "Practice", parent_id: "u5", doc_count: 4 },
];

export const mockBankQuestions: MockBankQuestion[] = [
  { id: "q1", course_id: "algebra-1", unit_id: "u5", question: "Solve for x: x² + 5x + 6 = 0", difficulty: "medium", source_doc: "ch5.pdf", status: "approved" },
  { id: "q2", course_id: "algebra-1", unit_id: "u5", question: "A ball is thrown upward with initial velocity 20 m/s. When does it hit the ground?", difficulty: "hard", source_doc: "ch5.pdf, worksheet3.pdf", status: "pending" },
  { id: "q3", course_id: "algebra-1", unit_id: "u5", question: "Factor: x² - 9", difficulty: "easy", source_doc: "ch5.pdf", status: "approved" },
  { id: "q4", course_id: "algebra-1", unit_id: "u5", question: "Find the vertex of y = 2x² - 8x + 3", difficulty: "medium", source_doc: "vertex_form_notes.pdf", status: "pending" },
  { id: "q5", course_id: "algebra-1", unit_id: "u5", question: "Solve using the quadratic formula: 3x² + 7x - 2 = 0", difficulty: "hard", source_doc: "ch5.pdf", status: "rejected" },
  { id: "q6", course_id: "algebra-1", unit_id: "u4", question: "Factor completely: 2x³ - 8x", difficulty: "medium", source_doc: "ch4.pdf", status: "approved" },
  { id: "q7", course_id: "algebra-1", unit_id: "u4", question: "Factor: x² - 7x + 12", difficulty: "easy", source_doc: "ch4.pdf", status: "approved" },
];

export const mockAssignments: MockAssignment[] = [
  { id: "a1", course_id: "algebra-1", type: "homework", title: "Quadratics HW #1", due_at: "Friday, 4/12 11:59pm", section_names: ["Period 1", "Period 3"], status: "grading", submitted: 47, total: 59 },
  { id: "a2", course_id: "algebra-1", type: "homework", title: "Factoring Practice", due_at: "Wednesday, 4/10 11:59pm", section_names: ["Period 1", "Period 3", "Period 5"], status: "completed", submitted: 82, total: 84 },
  { id: "a3", course_id: "algebra-1", type: "homework", title: "Vertex Form Worksheet", due_at: "Monday, 4/15 11:59pm", section_names: ["Period 1"], status: "published", submitted: 3, total: 28 },
  { id: "a4", course_id: "algebra-1", type: "homework", title: "Unit 5 Review (draft)", due_at: "—", section_names: [], status: "draft", submitted: 0, total: 0 },
  { id: "a5", course_id: "algebra-1", type: "test", title: "Unit 4 Test: Factoring", due_at: "Tuesday, 4/9 in class", section_names: ["Period 1", "Period 3", "Period 5"], status: "completed", submitted: 84, total: 84 },
  { id: "a6", course_id: "algebra-1", type: "test", title: "Unit 5 Test: Quadratics", due_at: "Wednesday, 4/17 in class", section_names: ["Period 1", "Period 3", "Period 5"], status: "draft", submitted: 0, total: 0 },
];

export function getCourse(id: string): MockCourse | undefined {
  return mockCourses.find((c) => c.id === id);
}
export function getSections(courseId: string): MockSection[] {
  return mockSections.filter((s) => s.course_id === courseId);
}
export function getUnits(courseId: string): MockUnit[] {
  return mockUnits.filter((u) => u.course_id === courseId);
}
export function getBankQuestions(courseId: string): MockBankQuestion[] {
  return mockBankQuestions.filter((q) => q.course_id === courseId);
}
export function getAssignments(courseId: string, type: "homework" | "test"): MockAssignment[] {
  return mockAssignments.filter((a) => a.course_id === courseId && a.type === type);
}
