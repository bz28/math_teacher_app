/**
 * Shared labels + accent colors for a session's subject and mode. Used
 * by the Solution-quality tab, its breakdown tables, and the drill-in so
 * a subject/mode reads identically everywhere it appears.
 */

export const SUBJECT_LABEL: Record<string, string> = {
  math: "Math",
  chemistry: "Chemistry",
  physics: "Physics",
  unknown: "Unspecified",
};

export const MODE_LABEL: Record<string, string> = {
  learn: "Learn",
  practice: "Practice",
  mock_test: "Mock test",
  unknown: "Unspecified",
};

export const SUBJECT_COLOR: Record<string, string> = {
  math: "#14130f",
  chemistry: "#4a6b3a",
  physics: "#3d5a78",
};

export const MODE_COLOR: Record<string, string> = {
  learn: "#14130f",
  practice: "#4a6b3a",
  mock_test: "#b8431a",
};

export const subjectLabel = (s: string): string => SUBJECT_LABEL[s] ?? s;
export const modeLabel = (m: string): string => MODE_LABEL[m] ?? m;
