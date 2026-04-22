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

/** Format a date relative to now (e.g., "2h ago", "Mar 24"). Returns "" for invalid input. */
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

/** Format an ISO date as "Mar 24" (current year) or "Mar 24, 2023". Returns null for invalid input. */
export function formatDate(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
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

/** Format bytes as "123 B" / "4.5 KB" / "1.2 MB". Returns "" for invalid input. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
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
