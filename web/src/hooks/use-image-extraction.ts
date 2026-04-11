"use client";

import { useCallback, useRef, useState } from "react";
import { image as imageApi, type ImageExtractResponse } from "@/lib/api";
import { cropImage } from "@/lib/crop-image";
import type { Rectangle } from "@/components/shared/rectangle-selector";

export type ExtractionPhase = "idle" | "extracting" | "select" | "result";

export interface UseImageExtractionOptions {
  subject: string;
  /** Max items the consumer can add (used to clamp rectangle count). */
  maxItems: number;
  /** Remaining image scans for the day; Infinity for pro users. */
  scansRemaining: number;
  /** Called when the user tries to upload after exhausting their scan quota. */
  onScanLimitReached?: () => void;
  /** Called after a successful extract completes (so the parent can refetch quota). */
  onExtractComplete?: () => void;
}

/**
 * Shared extraction state for Solve's snap / gallery entry points.
 *
 * Workflow:
 *   1. `pickFromCamera()` / `pickFromGallery()` opens a native file dialog.
 *   2. On a picked file, we either auto-extract or drop into manual rect mode.
 *   3. On success we set `result`, which the consumer renders via the
 *      extraction modal. On confirm the consumer reads `getConfirmedItems()`.
 *
 * Consumers must also render the hidden `<input type="file" />` elements
 * returned by `fileInputs` — one for camera (with `capture`) and one for
 * gallery — and the `<RectangleSelector />` when `phase === "select"`.
 */
export function useImageExtraction({
  subject,
  maxItems,
  scansRemaining,
  onScanLimitReached,
  onExtractComplete,
}: UseImageExtractionOptions) {
  const [phase, setPhase] = useState<ExtractionPhase>("idle");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [result, setResult] = useState<ImageExtractResponse | null>(null);
  const [cropImages, setCropImages] = useState<(string | undefined)[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const manualModeRequestedRef = useRef(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setImageBase64(null);
    setResult(null);
    setCropImages([]);
    setSelected([]);
    setProgress({ done: 0, total: 0 });
    setError(null);
    setEditingIndex(null);
  }, []);

  const autoExtract = useCallback(
    async (base64: string) => {
      setPhase("extracting");
      setProgress({ done: 0, total: 1 });
      try {
        const res = await imageApi.extract(base64, subject);
        setProgress({ done: 1, total: 1 });
        if (res.problems.length === 0) {
          setError("No problems found. Try drawing rectangles manually.");
          setPhase("select");
          return;
        }
        onExtractComplete?.();
        // Attach original image if single problem contains a diagram
        // (bracket description). The photo IS the diagram.
        const hasDiagram = res.problems.length === 1 && /\[.+\]/.test(res.problems[0]);
        setCropImages(new Array(res.problems.length).fill(hasDiagram ? base64 : undefined));
        setSelected(new Array(res.problems.length).fill(true));
        setResult(res);
        setPhase("result");
      } catch {
        setError("Extraction failed. Try drawing rectangles manually.");
        setPhase("select");
      }
    },
    [subject, onExtractComplete],
  );

  const extractRectangles = useCallback(
    async (rectangles: Rectangle[]) => {
      if (!imageBase64) return;
      setPhase("extracting");
      setProgress({ done: 0, total: rectangles.length });

      const allProblems: string[] = [];
      const allCropImages: (string | undefined)[] = [];
      let worstConfidence: "high" | "medium" | "low" = "high";

      for (let i = 0; i < rectangles.length; i += 3) {
        const batch = rectangles.slice(i, i + 3);
        const crops = await Promise.all(batch.map((rect) => cropImage(imageBase64, rect)));
        const results = await Promise.allSettled(
          crops.map((cropped) => imageApi.extract(cropped, subject)),
        );

        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          if (r.status !== "fulfilled") continue;
          for (const p of r.value.problems) {
            allProblems.push(p);
            allCropImages.push(crops[j]);
          }
          if (r.value.confidence === "low") worstConfidence = "low";
          else if (r.value.confidence === "medium" && worstConfidence !== "low") worstConfidence = "medium";
        }
        setProgress({ done: Math.min(i + 3, rectangles.length), total: rectangles.length });
      }

      if (allProblems.length === 0) {
        setError("No problems found. Try drawing larger rectangles.");
        reset();
        return;
      }

      onExtractComplete?.();
      setResult({ problems: allProblems, confidence: worstConfidence });
      setCropImages(allCropImages);
      setSelected(new Array(allProblems.length).fill(true));
      setPhase("result");
    },
    [imageBase64, subject, onExtractComplete, reset],
  );

  const processFile = useCallback(
    (file: File) => {
      setError(null);
      setEditingIndex(null);

      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("Image must be under 5MB.");
        return;
      }
      if (scansRemaining <= 0) {
        onScanLimitReached?.();
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        setImageBase64(base64);
        if (manualModeRequestedRef.current) {
          manualModeRequestedRef.current = false;
          setPhase("select");
        } else {
          autoExtract(base64);
        }
      };
      reader.readAsDataURL(file);
    },
    [autoExtract, scansRemaining, onScanLimitReached],
  );

  const onCameraChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = "";
    },
    [processFile],
  );

  const onGalleryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = "";
    },
    [processFile],
  );

  const pickFromCamera = useCallback(() => cameraInputRef.current?.click(), []);
  const pickFromGallery = useCallback(() => galleryInputRef.current?.click(), []);
  const pickForManualCrop = useCallback(() => {
    manualModeRequestedRef.current = true;
    galleryInputRef.current?.click();
  }, []);

  const toggleSelected = useCallback((index: number) => {
    setSelected((prev) => prev.map((s, i) => (i === index ? !s : s)));
  }, []);

  const updateProblemText = useCallback((index: number, text: string) => {
    setResult((prev) =>
      prev
        ? { ...prev, problems: prev.problems.map((p, i) => (i === index ? text : p)) }
        : prev,
    );
  }, []);

  const cancelSelect = useCallback(() => {
    setPhase("idle");
    setImageBase64(null);
    manualModeRequestedRef.current = false;
  }, []);

  const closeResult = useCallback(() => {
    reset();
  }, [reset]);

  /**
   * Read the user-confirmed items (text + optional image) clamped to the
   * caller's remaining slot count. Call from the modal's confirm handler.
   */
  const getConfirmedItems = useCallback(
    (remaining = maxItems): { text: string; image?: string }[] => {
      if (!result) return [];
      return result.problems
        .map((text, i) => ({ text, image: cropImages[i] }))
        .filter((_, i) => selected[i])
        .slice(0, remaining);
    },
    [result, cropImages, selected, maxItems],
  );

  return {
    // state
    phase,
    imageBase64,
    result,
    selected,
    progress,
    error,
    editingIndex,
    // entry points
    pickFromCamera,
    pickFromGallery,
    pickForManualCrop,
    // rectangle flow
    extractRectangles,
    cancelSelect,
    // result modal
    toggleSelected,
    updateProblemText,
    setEditingIndex,
    getConfirmedItems,
    closeResult,
    reset,
    // file-input refs the consumer must mount
    cameraInputRef,
    galleryInputRef,
    onCameraChange,
    onGalleryChange,
  };
}
