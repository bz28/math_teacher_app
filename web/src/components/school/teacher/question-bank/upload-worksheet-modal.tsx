"use client";

import { useCallback, useEffect, useState } from "react";
import { teacher, type BankJob, type TeacherUnit } from "@/lib/api";
import { topUnits } from "@/lib/units";

const MAX_IMAGES = 10;
const ACCEPTED_TYPES = ["image/jpeg", "image/png"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix — backend expects raw base64
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function UploadWorksheetModal({
  courseId,
  onClose,
  onStarted,
}: {
  courseId: string;
  onClose: () => void;
  onStarted: (job: BankJob) => void;
}) {
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [unitId, setUnitId] = useState<string | null | undefined>(undefined);
  const [files, setFiles] = useState<{ file: File; preview: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    teacher
      .units(courseId)
      .then((res) => setUnits(res.units))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load units"),
      )
      .finally(() => setLoading(false));
  }, [courseId]);

  const addFiles = useCallback(
    (incoming: File[]) => {
      const valid = incoming.filter((f) => ACCEPTED_TYPES.includes(f.type));
      if (valid.length < incoming.length) {
        setError("Only JPEG and PNG images are accepted.");
      }
      const remaining = MAX_IMAGES - files.length;
      const toAdd = valid.slice(0, remaining).map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));
      if (toAdd.length > 0) setFiles((prev) => [...prev, ...toAdd]);
    },
    [files.length],
  );

  const removeFile = (index: number) => {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles],
  );

  const hasChosenUnit = unitId !== undefined;
  const explicitUncategorized = unitId === null;

  const submit = async () => {
    if (files.length === 0) {
      setError("Upload at least one worksheet image.");
      return;
    }
    if (!hasChosenUnit) {
      setError("Pick a unit to save extracted questions to.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const images = await Promise.all(files.map((f) => fileToBase64(f.file)));
      const job = await teacher.uploadWorksheet(courseId, {
        images,
        unit_id: unitId,
      });
      onStarted(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={submitting ? undefined : onClose}
    >
      <form
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <h2 className="text-base font-bold text-text-primary">
            Upload Worksheet
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
          >
            &#10005;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-sm text-text-muted">
            Upload photos of an existing worksheet or problem set. Claude will
            extract each problem (up to ~40 per upload), solve it, and add it to
            your question bank for review.
          </p>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="relative mt-4 rounded-[--radius-lg] border-2 border-dashed border-border-light bg-bg-base/40 p-6 text-center transition-colors hover:border-primary/40"
          >
            {files.length === 0 ? (
              <>
                <div className="text-4xl" aria-hidden>
                  &#128247;
                </div>
                <p className="mt-2 text-sm font-semibold text-text-primary">
                  Drop worksheet images here
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  or click to browse &middot; JPEG / PNG &middot; up to{" "}
                  {MAX_IMAGES} images
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-wrap justify-center gap-3">
                  {files.map((f, i) => (
                    <div key={f.preview} className="group relative">
                      {/* blob: URL preview — next/image can't optimize these */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.preview}
                        alt={f.file.name}
                        className="h-24 w-24 rounded-[--radius-md] border border-border-light object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={`Remove ${f.file.name}`}
                      >
                        &#10005;
                      </button>
                      <p className="mt-1 max-w-[96px] truncate text-[10px] text-text-muted">
                        {f.file.name}
                      </p>
                    </div>
                  ))}
                </div>
                {files.length < MAX_IMAGES && (
                  <p className="mt-3 text-xs text-text-muted">
                    {files.length}/{MAX_IMAGES} images &middot; drop more or
                    click to add
                  </p>
                )}
              </>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              onChange={(e) => {
                if (e.target.files) addFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Upload worksheet images"
            />
          </div>

          {/* Save-to unit picker — same pattern as generate modal */}
          <div className="mt-5 rounded-[--radius-lg] border border-border-light bg-bg-base/40 p-4">
            <label className="text-sm font-bold text-text-primary">
              &#128194; Save to{" "}
              <span className="font-normal text-text-muted">
                &middot; required
              </span>
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              Extracted questions will be organized under this unit.
            </p>

            {loading ? (
              <p className="mt-3 text-sm text-text-muted">Loading units...</p>
            ) : topUnits(units).length === 0 ? (
              <div className="mt-3 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-3 text-center text-xs italic text-text-muted">
                No units yet. Create one in the Materials tab first.
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {topUnits(units).map((u) => {
                  const active = unitId === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setUnitId(u.id)}
                      className={`rounded-[--radius-pill] border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        active
                          ? "border-primary bg-primary text-white"
                          : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:bg-bg-subtle"
                      }`}
                    >
                      {active && <span className="mr-1">&#10003;</span>}
                      {u.name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setUnitId(null)}
                  className={`rounded-[--radius-pill] border border-dashed px-3 py-1.5 text-xs font-semibold transition-colors ${
                    explicitUncategorized
                      ? "border-text-muted bg-bg-subtle text-text-primary"
                      : "border-text-muted/40 bg-transparent text-text-muted hover:bg-bg-subtle"
                  }`}
                >
                  {explicitUncategorized && (
                    <span className="mr-1">&#10003;</span>
                  )}
                  Uncategorized
                </button>
              </div>
            )}

            {!hasChosenUnit && topUnits(units).length > 0 && (
              <p className="mt-2 text-[11px] italic text-text-muted">
                Pick a unit (or Uncategorized) to enable upload.
              </p>
            )}
            {explicitUncategorized && (
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                &#9888; These questions won&rsquo;t be organized under any unit.
                You can move them later.
              </p>
            )}
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-border-light px-6 py-3">
          <button
            type="submit"
            disabled={submitting || loading || files.length === 0 || !hasChosenUnit}
            title={
              files.length === 0
                ? "Upload at least one image"
                : !hasChosenUnit
                  ? "Pick a unit first"
                  : ""
            }
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Uploading..." : "Upload & Extract"}
          </button>
        </div>
      </form>
    </div>
  );
}
