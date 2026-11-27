// Shapes shared by the homework detail page and its pieces.

import type {
  HomeworkGraphChecklist,
  HomeworkPoints,
  TeacherAssignment,
  TeacherRubric,
} from "@/lib/api";

export interface AssignmentProblem {
  bank_item_id: string;
  position: number;
  question: string;
  /** Pre-rendered geometry SVG; null when the problem has no figure. */
  figure_svg: string | null;
  solution_steps: { title: string; description: string; figure_svg?: string | null }[] | null;
  final_answer: string | null;
  /** Practice only: the wrong options the student runner mixes with
   *  final_answer to make each problem multiple choice. */
  distractors?: string[] | null;
  difficulty: string;
}

// Inline-editable fields with their own SaveState — a saving units
// field doesn't block a separate due-date edit. Description is the
// student-visible instructions block under the title; the rest live
// in the Configuration accordion + grading card below the problems.
export type ConfigField =
  | "units"
  | "dueAt"
  | "latePolicy"
  | "sections"
  | "rubric"
  | "description"
  | "points";


/** The homework as the page holds it: the assignment plus its content,
 *  rubric, points and graph checklists. */
export type HomeworkDetail = TeacherAssignment & {
  content: unknown;
  rubric: TeacherRubric | null;
  points: HomeworkPoints;
  graph_checklists: Record<string, HomeworkGraphChecklist>;
};
