"use client";

import { useState, useRef, useCallback } from "react";
import { image as imageApi, type ImageExtractResponse } from "@/lib/api";
import { Button, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import { cropImage } from "@/lib/crop-image";
import { MathText } from "./math-text";
import { RectangleSelector, type Rectangle } from "./rectangle-selector";

interface ImageUploadProps {
  subject: string;
  onProblemsExtracted: (problems: { text: string; image?: string }[]) => void;
  maxProblems?: number;
  currentQueueLength?: number;
  /** Remaining image scans for the day (from entitlements). Pass Infinity for pro users. */
  scansRemaining?: number;
  /** Called when scan limit is reached and user tries to upload */
  onScanLimitReached?: () => void;
  /** Called after extraction completes (use to refresh quota counts) */
  onExtractComplete?: () => void;
  /** Called when the phase changes — parent can use this to adjust layout */
  onPhaseChange?: (phase: "upload" | "select" | "extracting") => void;
}

export function ImageUpload({
  subject,
  onProblemsExtracted,
  maxProblems = 10,
  currentQueueLength = 0,
  scansRemaining = Infinity,
  onScanLimitReached,
  onExtractComplete,
  onPhaseChange,
}: ImageUploadProps) {
  const [phase, _setPhase] = useState<"upload" | "select" | "extracting">("upload");
  const setPhase = useCallback((p: "upload" | "select" | "extracting") => {
    _setPhase(p);
    onPhaseChange?.(p);
  }, [onPhaseChange]);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [extractProgress, setExtractProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImageExtractResponse | null>(null);
  const [cropImages, setCropImages] = useState<(string | undefined)[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const remaining = maxProblems - currentQueueLength;

  const [manualMode, setManualMode] = useState(false);

  const autoExtract = useCallback(
    async (base64: string) => {
      setPhase("extracting");
      setExtractProgress({ done: 0, total: 1 });
      try {
        const res = await imageApi.extract(base64, subject);
        setExtractProgress({ done: 1, total: 1 });
        if (res.problems.length === 0) {
          setError("No problems found. Try selecting areas manually.");
          setManualMode(true);
          setPhase("select");
          return;
        }
        onExtractComplete?.();
        setResult(res);
        // Attach original image when single problem has a diagram (bracket description).
        // The original photo IS the diagram — cheaper than generating SVG during extraction.
        const hasDiagram = res.problems.length === 1 && /\[.+\]/.test(res.problems[0]);
        setCropImages(new Array(res.problems.length).fill(hasDiagram ? base64 : undefined));
        setSelected(new Array(res.problems.length).fill(true));
        setPhase("upload");
        setImageBase64(null);
      } catch {
        setError("Extraction failed. Try selecting areas manually.");
        setManualMode(true);
        setPhase("select");
      }
    },
    [subject, setPhase, onExtractComplete],
  );

  const processFile = useCallback(
    (file: File) => {
      setError(null);
      setManualMode(false);
      setEditingIndex(null);

      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("Image must be under 5MB.");
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        setImageBase64(base64);
        autoExtract(base64);
      };
      reader.readAsDataURL(file);
    },
    [autoExtract],
  );

  const handleExtractRectangles = useCallback(
    async (rectangles: Rectangle[]) => {
      if (!imageBase64) return;
      setPhase("extracting");
      setExtractProgress({ done: 0, total: rectangles.length });

      const allProblems: string[] = [];
      const allCropImages: (string | undefined)[] = [];
      let worstConfidence: string = "high";

      // Process in batches of 3
      for (let i = 0; i < rectangles.length; i += 3) {
        const batch = rectangles.slice(i, i + 3);
        const crops = await Promise.all(
          batch.map((rect) => cropImage(imageBase64, rect)),
        );
        const results = await Promise.allSettled(
          crops.map((cropped) => imageApi.extract(cropped, subject)),
        );

        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          if (r.status === "fulfilled") {
            for (const p of r.value.problems) {
              allProblems.push(p);
              allCropImages.push(crops[j]);
            }
            if (r.value.confidence === "low") worstConfidence = "low";
            else if (r.value.confidence === "medium" && worstConfidence !== "low")
              worstConfidence = "medium";
          }
        }
        setExtractProgress({ done: Math.min(i + 3, rectangles.length), total: rectangles.length });
      }

      if (allProblems.length === 0) {
        setError("No problems found in the selected areas. Try drawing larger rectangles.");
        setPhase("upload");
        setImageBase64(null);
        return;
      }

      onExtractComplete?.();
      setResult({ problems: allProblems, confidence: worstConfidence as "high" | "medium" | "low" });
      setCropImages(allCropImages);
      setSelected(new Array(allProblems.length).fill(true));
      setPhase("upload");
      setImageBase64(null);
    },
    [imageBase64, subject, setPhase, onExtractComplete],
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
    e.target.value = "";
  }

  const closeResultModal = useCallback(() => {
    setResult(null);
    setEditingIndex(null);
  }, []);

  function handleConfirm() {
    if (!result) return;
    const items = result.problems
      .map((text, i) => ({ text, image: cropImages[i] }))
      .filter((_, i) => selected[i])
      .slice(0, remaining);
    onProblemsExtracted(items);
    setCropImages([]);
    setSelected([]);
    closeResultModal();
  }

  function toggleSelected(index: number) {
    setSelected((prev) => prev.map((s, i) => (i === index ? !s : s)));
  }

  function updateProblemText(index: number, text: string) {
    setResult((prev) =>
      prev
        ? {
            ...prev,
            problems: prev.problems.map((p, i) => (i === index ? text : p)),
          }
        : prev,
    );
  }

  // Rectangle selection phase (manual fallback)
  if (phase === "select" && imageBase64 && manualMode) {
    return (
      <RectangleSelector
        imageBase64={imageBase64}
        onConfirm={handleExtractRectangles}
        onCancel={() => {
          setPhase("upload");
          setImageBase64(null);
          setManualMode(false);
        }}
        maxRectangles={Math.min(10, remaining, scansRemaining)}
        limitHint={scansRemaining < Infinity && scansRemaining <= remaining ? "scan limit" : undefined}
      />
    );
  }

  // Extracting phase
  if (phase === "extracting") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[--radius-lg] border-2 border-dashed border-primary bg-primary-bg p-8 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-primary border-t-transparent" />
        <p className="text-sm font-semibold text-primary">
          Extracting problems from image...
        </p>
        <p className="text-xs text-text-muted">This usually takes a few seconds</p>
      </div>
    );
  }

  const scanLimitReached = scansRemaining <= 0;
  const queueFull = remaining <= 0;

  return (
    <>
      {/* Upload area */}
      <div
        onDragOver={(e) => {
          if (scanLimitReached || queueFull) return;
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => { if (!scanLimitReached && !queueFull) handleDrop(e); }}
        onClick={() => {
          if (scanLimitReached) { onScanLimitReached?.(); }
          else if (queueFull) { /* blocked — queue is full */ }
          else { fileInputRef.current?.click(); }
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-[--radius-lg] border-2 border-dashed p-8 text-center transition-colors",
          scanLimitReached || queueFull
            ? "cursor-not-allowed border-border bg-surface opacity-60"
            : "cursor-pointer",
          !scanLimitReached && !queueFull && dragActive
            ? "border-primary bg-primary-bg"
            : !scanLimitReached && !queueFull ? "border-border hover:border-primary/40 hover:bg-primary-bg/30" : "",
        )}
      >
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-full", scanLimitReached || queueFull ? "bg-border-light text-text-muted" : "bg-primary-bg text-primary")}>
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {scanLimitReached ? "Daily scan limit reached" : queueFull ? "Problem queue is full" : "Upload a photo"}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {scanLimitReached
              ? "Upgrade to Pro for unlimited scans."
              : queueFull
                ? "You've reached your daily problem limit. Remove a queued problem or upgrade to Pro."
                : scansRemaining < Infinity
                  ? `Drag and drop or click to browse. ${scansRemaining} scan${scansRemaining !== 1 ? "s" : ""} remaining today.`
                  : "Drag and drop or click to browse. Max 5MB."}
          </p>
        </div>
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
      <Modal open={!!result} onClose={closeResultModal}>
        {result && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary">
                Extracted Problems
              </h2>
              <p className="text-sm text-text-secondary">
                {result.problems.length} problem{result.problems.length !== 1 && "s"} found — review and edit before adding
              </p>
            </div>

            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {result.problems.map((problem, i) => {
                const isEditing = editingIndex === i;
                return (
                  <div
                    key={i}
                    className={cn(
                      "rounded-[--radius-md] border p-3 transition-colors",
                      selected[i] ? "border-primary bg-primary-bg/50" : "border-border-light",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {isEditing ? (
                        <>
                          <input
                            type="checkbox"
                            checked={selected[i]}
                            onChange={() => toggleSelected(i)}
                            className="mt-1 h-4 w-4 flex-shrink-0 accent-primary"
                          />
                          <div className="min-w-0 flex-1">
                            <textarea
                              value={problem}
                              onChange={(e) => updateProblemText(i, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setEditingIndex(null);
                              }}
                              rows={Math.max(4, problem.split("\n").length + 1)}
                              autoFocus
                              className="w-full resize-y rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2.5 font-mono text-sm leading-relaxed text-text-primary outline-none focus:border-primary"
                              spellCheck={false}
                            />
                            <p className="mt-1 text-[11px] text-text-muted">
                              Edit the LaTeX directly. Press <kbd className="rounded bg-card px-1 font-mono">Esc</kbd> to cancel.
                            </p>
                          </div>
                        </>
                      ) : (
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selected[i]}
                            onChange={() => toggleSelected(i)}
                            className="mt-1 h-4 w-4 flex-shrink-0 accent-primary"
                          />
                          <span className="min-w-0 flex-1 text-sm text-text-primary">
                            <MathText text={problem} />
                          </span>
                        </label>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingIndex(isEditing ? null : i)}
                        className="flex-shrink-0 rounded-[--radius-sm] px-2 py-1 text-xs font-semibold text-text-secondary hover:bg-primary-bg hover:text-primary"
                      >
                        {isEditing ? "Done" : "Edit"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={closeResultModal}>
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
