import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { requestCameraAccess, requestGalleryAccess } from "./usePermissions";

/**
 * Launch camera, return base64 string on success, or null if cancelled/denied.
 * Shared by MockTestScreen and PracticeBatchView for work-image attachment.
 */
export async function captureWorkImage(): Promise<string | null> {
  if (!(await requestCameraAccess())) return null;

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    quality: 0.7,
    base64: true,
  });

  if (!result.canceled && result.assets[0]?.base64) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return result.assets[0].base64;
  }

  return null;
}

/**
 * Pick an existing photo from the library and return its base64, or null if
 * cancelled/denied. Keeps allowsEditing so the student can crop to the work,
 * mirroring the camera flow.
 */
export async function pickWorkImageFromLibrary(): Promise<string | null> {
  if (!(await requestGalleryAccess())) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    quality: 0.7,
    base64: true,
  });

  if (!result.canceled && result.assets[0]?.base64) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return result.assets[0].base64;
  }

  return null;
}

export interface PickedPdf {
  /** Raw base64 (no data: prefix) — what the submit endpoint expects. */
  base64: string;
  filename: string;
}

/**
 * Pick a PDF from the device and return its base64 + filename, or null if
 * cancelled. The backend accepts JPEG/PNG/PDF (detected by magic bytes), so a
 * raw base64 PDF string submits through the same `files` array as photos.
 */
export async function pickWorkPdf(): Promise<PickedPdf | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/pdf",
    copyToCacheDirectory: true,
    multiple: false,
  });

  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;

  const base64 = await readAsStringAsync(asset.uri, { encoding: "base64" });
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  return { base64, filename: asset.name ?? "document.pdf" };
}
