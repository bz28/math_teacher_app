/** Shared style maps for the question bank tab + detail modal. */

export const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10",
  approved: "bg-green-50 text-green-700 dark:bg-green-500/10",
  rejected: "bg-gray-100 text-gray-500 dark:bg-gray-500/10",
  archived: "bg-gray-100 text-gray-500 dark:bg-gray-500/10",
};

export const STATUS_FILTERS: { key: "pending" | "approved" | "rejected"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];
