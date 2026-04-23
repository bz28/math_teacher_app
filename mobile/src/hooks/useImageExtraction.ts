import { useState } from "react";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { requestCameraAccess, requestGalleryAccess } from "./usePermissions";
import { extractObjectivesFromImage, extractProblemsFromImage } from "../services/api";
import { cropImage, type CropRegion } from "../utils/cropImage";
import { errorMessage } from "../utils/errorMessage";
import { imageToBase64 } from "../utils/imageToBase64";

export type ExtractionPhase = "idle" | "preview" | "selecting" | "extracting" | "results";

/** What kind of items the extraction is pulling out of the image.
 *  "problems" — snap a worksheet, get question text (Learn / Mock Test "Use mine").
 *  "objectives" — snap a study guide, get topic labels (Mock Test "From objectives"). */
export type ExtractionMode = "problems" | "objectives";

async function extractForMode(
  mode: ExtractionMode,
  imageBase64: string,
  subject: string,
): Promise<{ items: string[]; confidence: string }> {
  if (mode === "objectives") {
    const r = await extractObjectivesFromImage(imageBase64, subject);
    return { items: r.topics, confidence: r.confidence };
  }
  const r = await extractProblemsFromImage(imageBase64, subject);
  return { items: r.problems, confidence: r.confidence };
}

export interface ExtractionState {
  phase: ExtractionPhase;
  extracting: boolean;
  extractionProgress: { done: number; total: number } | null;
  problems: string[] | null;
  confidence: string;
  selected: boolean[];
  editingIndex: number | null;
  editingText: string;
  lastSource: "camera" | "gallery" | null;
  imageUri: string | null;
  imageDimensions: { width: number; height: number } | null;
}

const INITIAL_STATE: ExtractionState = {
  phase: "idle",
  extracting: false,
  extractionProgress: null,
  problems: null,
  confidence: "high",
  selected: [],
  editingIndex: null,
  editingText: "",
  lastSource: null,
  imageUri: null,
  imageDimensions: null,
};

export function useImageExtraction(
  queueLength: number,
  maxProblems: number,
  setError: (msg: string | null) => void,
  subject: string = "math",
  scansRemaining?: () => number,
  onScanLimitReached?: () => void,
  mode: ExtractionMode = "problems",
) {
  const [state, setState] = useState<ExtractionState>(INITIAL_STATE);
  const noun = mode === "objectives" ? "topic" : "problem";

  /** Pick image → show preview with Extract All / Select Areas options. */
  const pickImage = async (source: "camera" | "gallery") => {
    // Check scan limit before allowing image capture
    if (scansRemaining && onScanLimitReached && scansRemaining() <= 0) {
      onScanLimitReached();
      return;
    }

    const granted = source === "camera"
      ? await requestCameraAccess()
      : await requestGalleryAccess();
    if (!granted) return;

    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ base64: false, quality: 0.7, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({ base64: false, quality: 0.7, allowsEditing: false });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    if (!asset.uri) {
      setError("Could not read selected image.");
      return;
    }

    setState((prev) => ({
      ...prev,
      phase: "preview",
      imageUri: asset.uri,
      imageDimensions: asset.width && asset.height
        ? { width: asset.width, height: asset.height }
        : null,
      lastSource: source,
    }));
    setError(null);
  };

  /** Send the full image to API for automatic problem detection. */
  const extractFullImage = async () => {
    if (!state.imageUri) return;

    setState((prev) => ({
      ...prev,
      phase: "extracting",
      extracting: true,
      extractionProgress: null,
    }));

    try {
      const base64 = await imageToBase64(state.imageUri);
      const { items, confidence } = await extractForMode(mode, base64, subject);

      if (items.length === 0) {
        setError(
          mode === "objectives"
            ? "No topics found. Try a clearer photo of your study guide."
            : "No problems found. Try selecting areas manually.",
        );
        setState((prev) => ({ ...prev, phase: "preview", extracting: false }));
        return;
      }

      setState((prev) => ({
        ...prev,
        phase: "results",
        extracting: false,
        problems: items,
        confidence,
        selected: items.map(() => true),
        editingIndex: null,
      }));
    } catch (e) {
      const msg = errorMessage(e);
      if (msg.includes("Network") || msg.includes("fetch")) {
        setError("Network error — check your connection and try again.");
      } else {
        setError(msg || `Failed to extract ${noun}s from image.`);
      }
      setState((prev) => ({ ...prev, phase: "preview", extracting: false }));
    }
  };

  /** Enter rectangle selection mode (from preview or from results as fallback).
   *  Keeps existing problems so manual extractions can be appended. */
  const startManualSelect = () => {
    setState((prev) => ({
      ...prev,
      phase: "selecting",
    }));
    setError(null);
  };

  /** Process rectangles drawn by user. */
  const confirmRectangles = async (rectangles: CropRegion[]) => {
    if (!state.imageUri) return;

    setState((prev) => ({
      ...prev,
      phase: "extracting",
      extracting: true,
      extractionProgress: { done: 0, total: rectangles.length },
    }));

    try {
      const allProblems: string[] = [];
      let worstConfidence = "high";

      for (let i = 0; i < rectangles.length; i += 3) {
        const batch = rectangles.slice(i, i + 3);
        const crops = await Promise.all(
          batch.map((rect) => cropImage(state.imageUri!, rect)),
        );
        const results = await Promise.allSettled(
          crops.map((cropped) => extractForMode(mode, cropped, subject)),
        );

        for (const r of results) {
          if (r.status === "fulfilled") {
            allProblems.push(...r.value.items);
            if (r.value.confidence === "low") worstConfidence = "low";
            else if (r.value.confidence === "medium" && worstConfidence !== "low")
              worstConfidence = "medium";
          }
        }
        setState((prev) => ({
          ...prev,
          extractionProgress: { done: Math.min(i + 3, rectangles.length), total: rectangles.length },
        }));
      }

      if (allProblems.length === 0) {
        setError(`No ${noun}s found in the selected areas. Try drawing larger rectangles.`);
        setState((prev) => ({ ...prev, phase: "preview", extracting: false, extractionProgress: null }));
        return;
      }

      // Append to existing problems (user may have deselected bad auto-detect results)
      setState((prev) => {
        const existingProblems = prev.problems ?? [];
        const existingSelected = prev.selected ?? [];
        return {
          ...prev,
          phase: "results",
          extracting: false,
          extractionProgress: null,
          problems: [...existingProblems, ...allProblems],
          confidence: worstConfidence === "low" ? "low" : prev.confidence === "low" ? "low" : worstConfidence,
          selected: [...existingSelected, ...allProblems.map(() => true)],
          editingIndex: null,
        };
      });
    } catch {
      setError(`Failed to extract ${noun}s. Try again.`);
      setState((prev) => ({ ...prev, phase: "preview", extracting: false, extractionProgress: null }));
    }
  };

  /** Cancel rectangle selection → back to preview. */
  const cancelSelection = () => {
    setState((prev) => ({ ...prev, phase: "preview" }));
  };

  /** Cancel preview → back to idle. */
  const cancelPreview = () => {
    setState(INITIAL_STATE);
  };

  const dismiss = () => {
    setState(INITIAL_STATE);
  };

  const retry = () => {
    const { lastSource } = state;
    dismiss();
    if (lastSource) pickImage(lastSource);
  };

  const toggleSelected = (index: number) => {
    setState((prev) => ({
      ...prev,
      selected: prev.selected.map((v, i) => (i === index ? !v : v)),
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const startEdit = (index: number) => {
    setState((prev) => ({
      ...prev,
      editingIndex: index,
      editingText: prev.problems![index],
    }));
  };

  const setEditingText = (text: string) => {
    setState((prev) => ({ ...prev, editingText: text }));
  };

  const finishEdit = () => {
    setState((prev) => {
      if (prev.editingIndex === null || !prev.problems) return prev;
      const text = prev.editingText.trim();
      return {
        ...prev,
        problems: text
          ? prev.problems.map((p, i) => (i === prev.editingIndex ? text : p))
          : prev.problems,
        editingIndex: null,
        editingText: "",
      };
    });
  };

  const getSelectedProblems = (): string[] => {
    if (!state.problems) return [];
    return state.problems.filter((_, i) => state.selected[i]);
  };

  const getSelectedWithImages = (): { text: string; image?: string }[] => {
    if (!state.problems) return [];
    return state.problems
      .map((text) => ({ text, image: undefined }))
      .filter((_, i) => state.selected[i]);
  };

  const selectedCount = state.selected.filter(Boolean).length;
  const canAddMore = queueLength < maxProblems;

  return {
    ...state,
    mode,
    noun,
    selectedCount,
    canAddMore,
    pickImage,
    extractFullImage,
    confirmRectangles,
    cancelSelection,
    cancelPreview,
    startManualSelect,
    dismiss,
    retry,
    toggleSelected,
    startEdit,
    setEditingText,
    finishEdit,
    getSelectedProblems,
    getSelectedWithImages,
  };
}
