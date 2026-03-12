import { useState } from "react";
import { Alert, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { extractProblemsFromImage } from "../services/api";

export interface ExtractionState {
  extracting: boolean;
  problems: string[] | null;
  confidence: string;
  selected: boolean[];
  editingIndex: number | null;
  editingText: string;
  lastSource: "camera" | "gallery" | null;
}

const INITIAL_STATE: ExtractionState = {
  extracting: false,
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
) {
  const [state, setState] = useState<ExtractionState>(INITIAL_STATE);

  const pickImage = async (source: "camera" | "gallery") => {
    if (source === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Camera Access Required",
          "Please enable camera access in Settings to scan math problems.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Photo Access Required",
          "Please enable photo library access in Settings to select images.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
    }

    const options: ImagePicker.ImagePickerOptions = {
      base64: true,
      quality: 0.7,
      allowsEditing: false,
    };

    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.[0]?.base64) return;

    // ~7MB base64 ≈ 5MB decoded — reject before uploading
    const MAX_BASE64_LENGTH = 7 * 1024 * 1024;
    if (result.assets[0].base64.length > MAX_BASE64_LENGTH) {
      setError("Image is too large (max 5MB). Try a lower resolution photo.");
      return;
    }

    setState((prev) => ({ ...prev, extracting: true, lastSource: source }));
    setError(null);

    try {
      const { problems, confidence } = await extractProblemsFromImage(result.assets[0].base64);
      if (problems.length === 0) {
        setError("No math problems found. Try a clearer photo.");
        return;
      }
      setState((prev) => ({
        ...prev,
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
    } finally {
      setState((prev) => ({ ...prev, extracting: false }));
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
