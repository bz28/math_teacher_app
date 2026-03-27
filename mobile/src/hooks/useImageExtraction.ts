import { useState } from "react";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { requestCameraAccess, requestGalleryAccess } from "./usePermissions";
import { extractProblemsFromImage } from "../services/api";

export interface ExtractionState {
  extracting: boolean;
  extractionProgress: { done: number; total: number } | null;
  problems: string[] | null;
  confidence: string;
  selected: boolean[];
  editingIndex: number | null;
  editingText: string;
  lastSource: "camera" | "gallery" | null;
}

const INITIAL_STATE: ExtractionState = {
  extracting: false,
  extractionProgress: null,
  problems: null,
  confidence: "high",
  selected: [],
  editingIndex: null,
  editingText: "",
  lastSource: null,
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
      base64: true,
      quality: 0.7,
      allowsEditing: false,
      ...(source === "gallery" && { allowsMultipleSelection: true }),
    };

    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.length) return;

    // Validate all assets have base64 and aren't too large
    const MAX_BASE64_LENGTH = 7 * 1024 * 1024;
    const validAssets = result.assets.filter((asset) => {
      if (!asset.base64) return false;
      if (asset.base64.length > MAX_BASE64_LENGTH) return false;
      return true;
    });

    if (validAssets.length === 0) {
      setError(
        result.assets.some((a) => a.base64 && a.base64.length > MAX_BASE64_LENGTH)
          ? "Image(s) too large (max 5MB each). Try lower resolution photos."
          : "Could not read selected image(s).",
      );
      return;
    }

    setState((prev) => ({
      ...prev,
      extracting: true,
      extractionProgress: validAssets.length > 1 ? { done: 0, total: validAssets.length } : null,
      lastSource: source,
    }));
    setError(null);

    try {
      const allProblems: string[] = [];
      let worstConfidence = "high";

      // Process images in parallel
      const results = await Promise.allSettled(
        validAssets.map((asset) => extractProblemsFromImage(asset.base64!, subject)),
      );

      let done = 0;
      for (const r of results) {
        done++;
        if (validAssets.length > 1) {
          setState((prev) => ({
            ...prev,
            extractionProgress: { done, total: validAssets.length },
          }));
        }
        if (r.status === "fulfilled") {
          allProblems.push(...r.value.problems);
          if (r.value.confidence === "low" || (r.value.confidence === "medium" && worstConfidence === "high")) {
            worstConfidence = r.value.confidence;
          }
        }
      }

      const failedCount = results.filter((r) => r.status === "rejected").length;

      if (allProblems.length === 0) {
        setError(
          failedCount > 0
            ? `Failed to extract from ${failedCount} image${failedCount > 1 ? "s" : ""}. Try clearer photos.`
            : "No problems found. Try clearer photos.",
        );
        return;
      }

      if (failedCount > 0) {
        setError(`${failedCount} image${failedCount > 1 ? "s" : ""} failed — showing results from the rest.`);
      }

      setState((prev) => ({
        ...prev,
        problems: allProblems,
        confidence: worstConfidence,
        selected: allProblems.map(() => true),
        editingIndex: null,
      }));
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("Network") || msg.includes("fetch")) {
        setError("Network error — check your connection and try again.");
      } else {
        setError(msg || "Failed to extract problems from image.");
      }
    } finally {
      setState((prev) => ({ ...prev, extracting: false, extractionProgress: null }));
    }
  };

  const dismiss = () => {
    setState((prev) => ({
      ...prev,
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

  const selectedCount = state.selected.filter(Boolean).length;
  const canAddMore = queueLength < maxProblems;

  return {
    ...state,
    selectedCount,
    canAddMore,
    pickImage,
    dismiss,
    retry,
    toggleSelected,
    startEdit,
    setEditingText,
    finishEdit,
    getSelectedProblems,
  };
}
