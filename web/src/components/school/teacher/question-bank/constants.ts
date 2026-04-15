export const STATUS_FILTERS: { key: "pending" | "approved" | "rejected"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

// Difficulty chip color/label.
export const DIFFICULTY_STYLE: Record<string, { label: string; cls: string }> = {
  easy: {
    label: "easy",
    cls: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  },
  medium: {
    label: "medium",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  },
  hard: {
    label: "hard",
    cls: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  },
};

// Preset quantities for "How many?" generations. 3 covers the common
// "give me a few similar ones" case; 50 was struck because AI-generated
// batches that large are rarely review-worthy — teachers who really
// want more can still use Custom (backend cap is 50).
export const QUANTITY_CHIPS = [1, 3, 5, 10, 20] as const;
