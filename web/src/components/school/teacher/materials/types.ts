import type { TeacherDocument } from "@/lib/api";

/**
 * One row in the materials tab can be in exactly one transient state at a
 * time. This collapses six independent useState slots into a single
 * discriminated union so impossible combinations (renaming + deleting the
 * same row) can't be expressed.
 */
export type RowState =
  | { kind: "idle" }
  | { kind: "renaming"; id: string }
  | { kind: "deletingFolder"; id: string }
  | { kind: "movingDoc"; id: string }
  | { kind: "deletingDoc"; id: string };

export type Destination = { id: string | null; label: string };

export type SortMode = "name" | "size" | "added";

export function fileKind(doc: TeacherDocument): "pdf" | "image" {
  const t = (doc.file_type || "").toLowerCase();
  if (t.includes("pdf") || doc.filename.toLowerCase().endsWith(".pdf")) return "pdf";
  return "image";
}

export function formatSize(bytes: number): string {
  const kb = Math.max(1, Math.round(bytes / 1024));
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

export function formatDate(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

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
