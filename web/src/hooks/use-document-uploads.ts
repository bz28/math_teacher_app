import { useCallback, useState } from "react";
import { teacher, type TeacherDocument } from "@/lib/api";
import { uploadDocument } from "@/lib/upload-document";
import { useToast } from "@/components/ui/toast";

export type PendingUpload = {
  id: string;
  filename: string;
  size: number;
  error: string | null;
  file: File;
};

/**
 * Drives inline document uploads from the source-material picker on the
 * New Homework / New Practice wizards. Owns the in-flight `pending`
 * rows so they survive the picker unmounting (e.g. teacher clicks Back
 * to fix the title and returns) — the picker is a pure renderer over
 * what this hook exposes.
 *
 * On success the hook also refetches the doc list and adds the new id
 * to `selectedDocs` so the file is auto-selected without a second
 * click. A failed refetch shows a toast and skips the auto-select to
 * avoid leaving a phantom selection (id pointing at no row).
 *
 * `hasInflightUploads` lets the parent modal block close while an
 * upload is mid-flight; rows in the error state don't block close
 * because they're inert until the teacher retries or dismisses.
 *
 * `getUnitId` returns the destination unit at upload time. Read at
 * the moment the upload fires (not at hook init) so a parent that
 * lets the teacher switch topics still sends the current pick. Modals
 * gate the topic-switch buttons on `hasInflightUploads` to keep this
 * stable while a request is in flight.
 */
export function useDocumentUploads({
  courseId,
  getUnitId,
  setDocs,
  setSelectedDocs,
}: {
  courseId: string;
  getUnitId: () => string;
  setDocs: (docs: TeacherDocument[]) => void;
  setSelectedDocs: (updater: (prev: Set<string>) => Set<string>) => void;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const finishWithRefetch = useCallback(
    async (newId: string, filename: string) => {
      try {
        const r = await teacher.documents(courseId);
        setDocs(r.documents);
        setSelectedDocs((prev) => {
          const next = new Set(prev);
          next.add(newId);
          return next;
        });
      } catch {
        // The upload itself succeeded server-side. The list refetch
        // failed, so we can't show the new row right now. Skipping the
        // auto-select on purpose — adding `newId` to selectedDocs
        // without a matching row would forward an orphan id when the
        // teacher submits. Toast so the teacher knows the file is safe.
        toast.error(
          `${filename} uploaded, but the list didn't refresh. Reopen the modal to see it.`,
        );
      }
    },
    [courseId, setDocs, setSelectedDocs, toast],
  );

  const startOne = useCallback(
    async (file: File) => {
      const tempId = `pending-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      setPending((prev) => [
        ...prev,
        { id: tempId, filename: file.name, size: file.size, error: null, file },
      ]);
      try {
        const newId = await uploadDocument(courseId, file, getUnitId());
        await finishWithRefetch(newId, file.name);
        setPending((prev) => prev.filter((p) => p.id !== tempId));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Upload failed";
        setPending((prev) =>
          prev.map((p) => (p.id === tempId ? { ...p, error: msg } : p)),
        );
        toast.error(`Couldn't upload ${file.name}: ${msg}`);
      }
    },
    [courseId, finishWithRefetch, getUnitId, toast],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      for (const file of files) void startOne(file);
    },
    [startOne],
  );

  const retryPending = useCallback(
    (item: PendingUpload) => {
      setPending((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, error: null } : p)),
      );
      void (async () => {
        try {
          const newId = await uploadDocument(courseId, item.file, getUnitId());
          await finishWithRefetch(newId, item.filename);
          setPending((prev) => prev.filter((p) => p.id !== item.id));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Upload failed";
          setPending((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, error: msg } : p)),
          );
          toast.error(`Couldn't upload ${item.filename}: ${msg}`);
        }
      })();
    },
    [courseId, finishWithRefetch, getUnitId, toast],
  );

  const dismissPending = useCallback(
    (id: string) => setPending((prev) => prev.filter((p) => p.id !== id)),
    [],
  );

  const hasInflightUploads = pending.some((p) => p.error === null);

  return {
    pending,
    handleFiles,
    retryPending,
    dismissPending,
    hasInflightUploads,
  };
}
