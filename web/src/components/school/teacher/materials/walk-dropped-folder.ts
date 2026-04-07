import type { DroppedFolder, DroppedTree } from "./types";

const SUPPORTED_EXTENSIONS = /\.(pdf|png|jpe?g)$/i;

function isSupported(name: string): boolean {
  if (name.startsWith(".")) return false;
  return SUPPORTED_EXTENSIONS.test(name);
}

function emptyTree(): DroppedTree {
  return { folders: [], looseFiles: [], skipped: 0 };
}

/* ──────────────────────────────────────────────────────────────── *
 * Drag-and-drop path: walks a DataTransferItemList via the File
 * System API (`webkitGetAsEntry`). Top-level folders become units,
 * second-level folders become subfolders; anything deeper is
 * flattened into its nearest 2nd-level parent.
 * ──────────────────────────────────────────────────────────────── */

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          pump();
        }
      }, reject);
    };
    pump();
  });
}

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** Recursively flatten every file inside a directory entry. Used for
 *  depth-3+ folders that get merged up into their level-2 parent. */
async function collectFilesRecursive(
  entry: FileSystemDirectoryEntry,
): Promise<{ files: File[]; skipped: number }> {
  const files: File[] = [];
  let skipped = 0;
  const children = await readAllEntries(entry.createReader());
  for (const child of children) {
    if (child.isFile) {
      const file = await entryToFile(child as FileSystemFileEntry);
      if (isSupported(file.name)) files.push(file);
      else skipped += 1;
    } else if (child.isDirectory) {
      const nested = await collectFilesRecursive(child as FileSystemDirectoryEntry);
      files.push(...nested.files);
      skipped += nested.skipped;
    }
  }
  return { files, skipped };
}

/** Walk one top-level directory entry into a DroppedFolder. Files at
 *  the root become `folder.files`; child directories become subfolders
 *  (with deeper trees flattened into them). */
async function walkTopLevelFolder(
  entry: FileSystemDirectoryEntry,
): Promise<{ folder: DroppedFolder; skipped: number }> {
  const folder: DroppedFolder = { name: entry.name, files: [], subfolders: [] };
  let skipped = 0;
  const children = await readAllEntries(entry.createReader());
  for (const child of children) {
    if (child.isFile) {
      const file = await entryToFile(child as FileSystemFileEntry);
      if (isSupported(file.name)) folder.files.push(file);
      else skipped += 1;
    } else if (child.isDirectory) {
      const nested = await collectFilesRecursive(child as FileSystemDirectoryEntry);
      folder.subfolders.push({ name: child.name, files: nested.files });
      skipped += nested.skipped;
    }
  }
  return { folder, skipped };
}

export async function walkDataTransferItems(items: DataTransferItemList): Promise<DroppedTree> {
  const tree = emptyTree();
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  for (const entry of entries) {
    if (entry.isFile) {
      const file = await entryToFile(entry as FileSystemFileEntry);
      if (isSupported(file.name)) tree.looseFiles.push(file);
      else tree.skipped += 1;
    } else if (entry.isDirectory) {
      const result = await walkTopLevelFolder(entry as FileSystemDirectoryEntry);
      tree.folders.push(result.folder);
      tree.skipped += result.skipped;
    }
  }
  return tree;
}

/* ──────────────────────────────────────────────────────────────── *
 * Directory picker path: an `<input webkitdirectory>` returns a flat
 * FileList where each file has `webkitRelativePath` like
 * "Unit 1/worksheets/quiz.pdf". Reconstruct the same tree shape.
 * ──────────────────────────────────────────────────────────────── */

export function treeFromDirectoryPicker(fileList: FileList): DroppedTree {
  const tree = emptyTree();
  const byTop = new Map<string, DroppedFolder>();
  for (let i = 0; i < fileList.length; i += 1) {
    const file = fileList[i];
    const rel = file.webkitRelativePath;
    if (!rel) continue;
    const parts = rel.split("/");
    if (parts.length < 2) continue; // shouldn't happen with webkitdirectory
    const topName = parts[0];
    let folder = byTop.get(topName);
    if (!folder) {
      folder = { name: topName, files: [], subfolders: [] };
      byTop.set(topName, folder);
    }
    if (!isSupported(file.name)) {
      tree.skipped += 1;
      continue;
    }
    if (parts.length === 2) {
      folder.files.push(file);
    } else {
      // Level-2 subfolder name is parts[1]; deeper levels flatten into it.
      const subName = parts[1];
      let sub = folder.subfolders.find((s) => s.name === subName);
      if (!sub) {
        sub = { name: subName, files: [] };
        folder.subfolders.push(sub);
      }
      sub.files.push(file);
    }
  }
  tree.folders = [...byTop.values()];
  return tree;
}

/* ──────────────────────────────────────────────────────────────── *
 * Collision + naming helpers
 * ──────────────────────────────────────────────────────────────── */

export function detectCollisions(
  folders: DroppedFolder[],
  existingTopLevelNames: { id: string; name: string }[],
): { folder: DroppedFolder; existingUnitId: string }[] {
  const byLower = new Map(existingTopLevelNames.map((u) => [u.name.toLowerCase(), u.id]));
  return folders.flatMap((f) => {
    const hit = byLower.get(f.name.toLowerCase());
    return hit ? [{ folder: f, existingUnitId: hit }] : [];
  });
}

/** Returns a name that doesn't collide with `taken` (case-insensitive).
 *  Mutates `taken` by adding the returned name so subsequent calls in the
 *  same batch don't collide with each other either. */
export function uniqueName(base: string, taken: Set<string>): string {
  const lower = base.toLowerCase();
  if (!taken.has(lower)) {
    taken.add(lower);
    return base;
  }
  let n = 2;
  while (taken.has(`${lower} (${n})`)) n += 1;
  const next = `${base} (${n})`;
  taken.add(next.toLowerCase());
  return next;
}

export function fileCountInFolder(folder: DroppedFolder): number {
  return folder.files.length + folder.subfolders.reduce((acc, s) => acc + s.files.length, 0);
}

export function totalFileCount(tree: DroppedTree): number {
  return tree.looseFiles.length + tree.folders.reduce((acc, f) => acc + fileCountInFolder(f), 0);
}
