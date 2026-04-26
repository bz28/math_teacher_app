import type { TeacherDocument } from "@/lib/api";

/**
 * One row in the materials tab can be in exactly one transient state at a
 * time. Document move/delete happen through the bulk action bar now, so
 * only folder rename + folder delete live here.
 */
export type RowState =
  | { kind: "idle" }
  | { kind: "renaming"; id: string }
  | { kind: "deletingFolder"; id: string };

export type Destination = { id: string; label: string };

export type SortMode = "name" | "size" | "added";

/** A single top-level folder discovered in a drop or directory picker. */
export type DroppedFolder = {
  name: string;
  files: File[];
  subfolders: { name: string; files: File[] }[];
};

/** The normalized shape returned by both the drag-drop walker and the
 *  webkitdirectory picker. `skipped` counts files filtered out for being
 *  unsupported extensions or hidden (`.DS_Store`, dotfiles). */
export type DroppedTree = {
  folders: DroppedFolder[];
  looseFiles: File[];
  skipped: number;
};

export type ResolutionChoice = "merge" | "create" | "skip";

export type Collision = {
  folder: DroppedFolder;
  existingUnitId: string;
};

export function fileKind(doc: TeacherDocument): "pdf" | "image" {
  const t = (doc.file_type || "").toLowerCase();
  if (t.includes("pdf") || doc.filename.toLowerCase().endsWith(".pdf")) return "pdf";
  return "image";
}
