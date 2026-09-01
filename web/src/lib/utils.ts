import React from "react";
import { type ClassValue, clsx } from "clsx";

/** Merge Tailwind classes with conflict resolution via clsx. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** Render text with **bold** markdown into React elements. */
export function renderBold(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? React.createElement("strong", { key: i }, part.slice(2, -2))
      : part,
  );
}

/** Format a date relative to now (e.g., "2h ago", "Mar 24"). Returns "" for invalid input.
 *  Shared contract — keep byte-identical with dashboard/src/lib/format.ts and
 *  mobile/src/utils/dateFormatting.ts: "just now" / "Nm ago" / "Nh ago" / "Nd ago" (<7d), then "Mon D". */
export function formatRelativeDate(date: string | Date): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Format an ISO date as "Mar 24" (current year) or "Mar 24, 2023".
 * Pass `alwaysYear: true` to always include the year (useful when
 * organizing items across years, e.g. uploaded files).
 * Returns null for invalid input.
 */
export function formatDate(
  iso: string | undefined | null,
  opts: { alwaysYear?: boolean } = {},
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const showYear = opts.alwaysYear || d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
  });
}

/** "Due Mon, Mar 24" — or with ", 3:00 PM" appended when the time is non-midnight. */
export function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No due date";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return `Due ${date}`;
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Due ${date}, ${time}`;
}

/** "Due Mar 24" — compact variant of formatDue without weekday/time. */
export function formatDueShort(iso: string): string {
  const formatted = formatDate(iso);
  return formatted ? `Due ${formatted}` : "No due date";
}

/** "Today" / "Tomorrow" / "Due Thu" / "Due Apr 12" — for status-board
 *  contexts where the date is by definition upcoming and we want a
 *  punchy label, not a full one. Returns "" for invalid input. */
export function formatDueRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const dueDay = new Date(d);
  dueDay.setHours(0, 0, 0, 0);
  const days = Math.round((dueDay.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) {
    return `Due ${d.toLocaleDateString(undefined, { weekday: "short" })}`;
  }
  return `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** Format bytes as "123 B" / "5 KB" / "1.2 MB". Returns "" for invalid input. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/** Read a File as a data URL and resolve with the raw base64 (comma separator stripped). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Truncate text to a max length with ellipsis. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + "…";
}

/** Quiz/practice/mock-test result for a single question. */
export interface QuizResult {
  question: string;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean | null;
}

/** Deterministic shuffle for MCQ choices using a string hash. */
export function shuffleChoices(choices: string[], seed: number): string[] {
  return [...choices].sort((a, b) => {
    const ha = Array.from(a).reduce((h, c) => (h * 31 + c.charCodeAt(0) + seed) | 0, 0);
    const hb = Array.from(b).reduce((h, c) => (h * 31 + c.charCodeAt(0) + seed) | 0, 0);
    return ha - hb;
  });
}

/** Format seconds as m:ss elapsed time. */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Format seconds as "Xm Ys" for summary display. */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

/**
 * How a homework's section targeting reads to a teacher.
 *
 * An empty section list means three different things depending on
 * state, and calling them all the same thing is what makes teachers
 * distrust the blank default:
 *
 *   draft, course has sections — the default. Publishing fans the
 *       homework out to every section, so "All sections" is what is
 *       actually going to happen. Reads as a default, not a fact.
 *   draft, course has none — publishing will be refused outright
 *       ("This course has no sections yet"). Promising "All sections"
 *       here is a promise the publish button won't keep.
 *   published, empty — the sections it went to have since been
 *       deleted, so it reaches nobody. That is a problem, and should
 *       look like one.
 *
 * `courseSectionCount` is null when the caller doesn't know (list
 * cards don't load the course's sections). The zero case then can't be
 * told from the ordinary one; the detail page, which is where
 * publishing actually happens, always knows.
 */
export function sectionTargetLabel({
  selectedNames,
  status,
  courseSectionCount = null,
}: {
  selectedNames: string[];
  status: string;
  courseSectionCount?: number | null;
}): { label: string; tone: "normal" | "default" | "problem" } {
  if (selectedNames.length > 0) {
    return { label: selectedNames.join(", "), tone: "normal" };
  }
  if (status === "published") {
    return { label: "No sections", tone: "problem" };
  }
  if (courseSectionCount === 0) {
    return { label: "No sections in this course", tone: "problem" };
  }
  return { label: "All sections", tone: "default" };
}

/** Tailwind classes for a {@link sectionTargetLabel} tone. A default
 *  stays quiet; a problem has to interrupt someone skimming. */
export function sectionToneClass(
  tone: "normal" | "default" | "problem",
): string {
  if (tone === "default") return "italic";
  if (tone === "problem") {
    return "font-semibold text-[color:var(--color-warning-dark)]";
  }
  return "";
}
