// The four demo stories, in pitch order. Single source of truth for present
// mode: the jump-bar links, the ←/→ keyboard sequence, and the overview tiles
// all read from this list so the order can never drift between them.
//
// `key` matches the use-case card keys in data/demo-hub.json (integrity,
// grading, generation, teacher-day), which lets the overview remap each hub
// card to its /present/<key> route with no extra wiring.

export type PresentStory = {
  key: string;
  path: string;
  label: string;
};

export const PRESENT_STORIES: PresentStory[] = [
  { key: "integrity", path: "/present/integrity", label: "Understanding" },
  { key: "grading", path: "/present/grading", label: "Grading" },
  { key: "generation", path: "/present/generation", label: "Generation" },
  { key: "teacher-day", path: "/present/teacher-day", label: "Teacher's day" },
];

export const PRESENT_HOME = "/present";
