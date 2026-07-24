// The four demo stories, in pitch order. Single source of truth: the story
// shell's jump-bar links, the ←/→ keyboard sequence, and the front-door use-case
// tiles all read from this list so the order can never drift between them.
//
// `key` matches the use-case card keys in data/demo-hub.json (integrity,
// grading, generation, teacher-day), which lets the front door remap each card
// to its /<key> route with no extra wiring.

export type Story = {
  key: string;
  path: string;
  label: string;
};

export const STORIES: Story[] = [
  { key: "integrity", path: "/integrity", label: "Understanding" },
  { key: "grading", path: "/grading", label: "Grading" },
  { key: "generation", path: "/generation", label: "Generation" },
  { key: "teacher-day", path: "/teacher-day", label: "Teacher's day" },
];

// The front door — where the story shell's home affordances return to.
export const STORY_HOME = "/";
