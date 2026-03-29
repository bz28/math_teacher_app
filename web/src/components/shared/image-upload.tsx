"use client";

import { useState, useRef, useCallback } from "react";
import { image as imageApi, type ImageExtractResponse } from "@/lib/api";
import { Button, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";

interface ImageUploadProps {
  subject: string;
  onProblemsExtracted: (problems: string[]) => void;
  maxProblems?: number;
  currentQueueLength?: number;
}

export function ImageUpload({
  subject,
  onProblemsExtracted,
  maxProblems = 10,
  currentQueueLength = 0,
}: ImageUploadProps) {
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<ImageExtractResponse | null>(null);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const remaining = maxProblems - currentQueueLength;

  const processFile = useCallback(
    async (file: File) => {
      setError(null);

      // Validate
      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("Image must be under 5MB.");
        return;
      }

      // Convert to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        setExtracting(true);
        try {
          const res = await imageApi.extract(base64, subject);
          setResult(res);
          setSelected(new Array(res.problems.length).fill(true));
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setExtracting(false);
        }
      };
      reader.readAsDataURL(file);
    },
    [subject],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so same file can be uploaded again
    e.target.value = "";
  }

  function handleConfirm() {
    if (!result) return;
    const selectedProblems = result.problems.filter((_, i) => selected[i]);
    onProblemsExtracted(selectedProblems.slice(0, remaining));
    setResult(null);
    setSelected([]);
  }

  function toggleSelected(index: number) {
    setSelected((prev) => prev.map((s, i) => (i === index ? !s : s)));
  }

  return (
    <>
      {/* Upload area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-3 rounded-[--radius-lg] border-2 border-dashed p-8 text-center transition-colors",
          dragActive
            ? "border-primary bg-primary-bg"
            : "border-border hover:border-primary/40 hover:bg-primary-bg/30",
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-bg text-primary">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {extracting ? "Extracting problems..." : "Upload a photo"}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Drag and drop or click to browse. Max 5MB.
          </p>
        </div>
        {extracting && (
          <div className="h-1 w-32 overflow-hidden rounded-full bg-border-light">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {error && (
        <p className="mt-2 text-sm text-error">{error}</p>
      )}

      {/* Extraction results modal */}
      <Modal open={!!result} onClose={() => setResult(null)}>
        {result && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary">
                Extracted Problems
              </h2>
              <p className="text-sm text-text-secondary">
                {result.problems.length} problem{result.problems.length !== 1 && "s"} found
                (confidence: {result.confidence})
              </p>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto">
              {result.problems.map((problem, i) => (
                <label
                  key={i}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-[--radius-md] border p-3 transition-colors",
                    selected[i]
                      ? "border-primary bg-primary-bg/50"
                      : "border-border-light",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected[i]}
                    onChange={() => toggleSelected(i)}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span className="text-sm text-text-primary">{problem}</span>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setResult(null)}>
                Cancel
              </Button>
              <Button
                gradient
                onClick={handleConfirm}
                disabled={!selected.some(Boolean)}
              >
                Add {selected.filter(Boolean).length} Problem
                {selected.filter(Boolean).length !== 1 && "s"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
