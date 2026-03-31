import { useState } from "react";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { requestCameraAccess, requestGalleryAccess } from "./usePermissions";
import { extractProblemsFromImage } from "../services/api";
import { cropImage, type CropRegion } from "../utils/cropImage";
import { imageToBase64 } from "../utils/imageToBase64";

export type ExtractionPhase = "idle" | "selecting" | "extracting" | "results";

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
  /** Image URI preserved for manual rectangle fallback */
  imageUri: string | null;
  /** Image dimensions for rectangle selector */
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
) {
  const [state, setState] = useState<ExtractionState>(INITIAL_STATE);

  /** Pick image and auto-extract all problems from it. */
  const pickImage = async (source: "camera" | "gallery") => {
    const granted = source === "camera"
      ? await requestCameraAccess()
      : await requestGalleryAccess();
    if (!granted) return;

    const options: ImagePicker.ImagePickerOptions = {
      base64: false,
      quality: 0.7,
      allowsEditing: false,
    };

    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    if (!asset.uri) {
      setError("Could not read selected image.");
      return;
    }

    // Save URI/dimensions for manual fallback, then auto-extract
    setState((prev) => ({
      ...prev,
      phase: "extracting",
      extracting: true,
      extractionProgress: null,
      imageUri: asset.uri,
      imageDimensions: asset.width && asset.height
        ? { width: asset.width, height: asset.height }
        : null,
      lastSource: source,
    }));
    setError(null);

    try {
      const base64 = await imageToBase64(asset.uri);
      const { problems, confidence } = await extractProblemsFromImage(base64, subject);

      if (problems.length === 0) {
        setError("No problems found. Try again or select areas manually.");
        setState((prev) => ({ ...prev, phase: "idle", extracting: false }));
        return;
      }

      setState((prev) => ({
        ...prev,
        phase: "results",
        extracting: false,
        problems,
        confidence,
        selected: problems.map(() => true),
        editingIndex: null,
      }));
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Network") || msg.includes("fetch")) {
        setError("Network error — check your connection and try again.");
      } else {
        setError(msg || "Failed to extract problems from image.");
      }
      setState((prev) => ({ ...prev, phase: "idle", extracting: false, extractionProgress: null }));
    }
  };

  /** Process rectangles drawn by user in manual selection mode. */
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
          crops.map((cropped) => extractProblemsFromImage(cropped, subject)),
        );

        for (const r of results) {
          if (r.status === "fulfilled") {
            allProblems.push(...r.value.problems);
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
        setError("No problems found in the selected areas. Try drawing larger rectangles.");
        setState((prev) => ({ ...prev, phase: "idle", extracting: false, extractionProgress: null }));
        return;
      }

      setState((prev) => ({
        ...prev,
        phase: "results",
        extracting: false,
        extractionProgress: null,
        problems: allProblems,
        confidence: worstConfidence,
        selected: allProblems.map(() => true),
        editingIndex: null,
      }));
    } catch {
      setError("Failed to extract problems. Try again.");
      setState((prev) => ({ ...prev, phase: "idle", extracting: false, extractionProgress: null }));
    }
  };

  /** Enter manual rectangle selection (fallback from auto-detect results). */
  const startManualSelect = () => {
    setState((prev) => ({
      ...prev,
      phase: "selecting",
      problems: null,
      selected: [],
    }));
    setError(null);
  };

  /** Cancel rectangle selection and go back to idle. */
  const cancelSelection = () => {
    setState(INITIAL_STATE);
  };

  const dismiss = () => {
    setState((prev) => ({
      ...prev,
      phase: "idle",
      problems: null,
      confidence: "high",
      selected: [],
      editingIndex: null,
      editingText: "",
      imageUri: null,
      imageDimensions: null,
    }));
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
      .map((text, i) => ({ text, image: undefined }))
      .filter((_, i) => state.selected[i]);
  };

  const selectedCount = state.selected.filter(Boolean).length;
  const canAddMore = queueLength < maxProblems;

  return {
    ...state,
    selectedCount,
    canAddMore,
    pickImage,
    confirmRectangles,
    cancelSelection,
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
