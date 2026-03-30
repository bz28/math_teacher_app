import { useState } from "react";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { requestCameraAccess, requestGalleryAccess } from "./usePermissions";
import { extractProblemsFromImage } from "../services/api";
import { cropImage, type CropRegion } from "../utils/cropImage";

export type ExtractionPhase = "idle" | "selecting" | "extracting" | "results";

export interface ExtractionState {
  phase: ExtractionPhase;
  extracting: boolean;
  extractionProgress: { done: number; total: number } | null;
  problems: string[] | null;
  /** Cropped images parallel to problems array */
  cropImages: (string | undefined)[];
  confidence: string;
  selected: boolean[];
  editingIndex: number | null;
  editingText: string;
  lastSource: "camera" | "gallery" | null;
  /** Image URI for rectangle selection */
  imageUri: string | null;
  /** Image dimensions for coordinate scaling */
  imageDimensions: { width: number; height: number } | null;
}

const INITIAL_STATE: ExtractionState = {
  phase: "idle",
  extracting: false,
  extractionProgress: null,
  problems: null,
  cropImages: [],
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

  const pickImage = async (source: "camera" | "gallery") => {
    const granted = source === "camera"
      ? await requestCameraAccess()
      : await requestGalleryAccess();
    if (!granted) return;

    const options: ImagePicker.ImagePickerOptions = {
      base64: false, // Don't need base64 yet — just URI for rectangle selection
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

    setState((prev) => ({
      ...prev,
      phase: "selecting",
      imageUri: asset.uri,
      imageDimensions: asset.width && asset.height
        ? { width: asset.width, height: asset.height }
        : null,
      lastSource: source,
    }));
    setError(null);
  };

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
      const allCropImages: (string | undefined)[] = [];
      let worstConfidence = "high";

      // Process in batches of 3
      for (let i = 0; i < rectangles.length; i += 3) {
        const batch = rectangles.slice(i, i + 3);
        const crops = await Promise.all(
          batch.map((rect) => cropImage(state.imageUri!, rect)),
        );
        const results = await Promise.allSettled(
          crops.map((cropped) => extractProblemsFromImage(cropped, subject)),
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
        setState((prev) => ({
          ...prev,
          extractionProgress: { done: Math.min(i + 3, rectangles.length), total: rectangles.length },
        }));
      }

      if (allProblems.length === 0) {
        setError("No problems found in the selected areas. Try drawing larger rectangles.");
        setState(INITIAL_STATE);
        return;
      }

      setState((prev) => ({
        ...prev,
        phase: "results",
        extracting: false,
        extractionProgress: null,
        problems: allProblems,
        cropImages: allCropImages,
        confidence: worstConfidence,
        selected: allProblems.map(() => true),
        editingIndex: null,
        imageUri: null,
        imageDimensions: null,
      }));
    } catch {
      setError("Failed to extract problems. Try again.");
      setState(INITIAL_STATE);
    }
  };

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
      .map((text, i) => ({ text, image: state.cropImages[i] }))
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
