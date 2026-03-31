import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { requestCameraAccess } from "./usePermissions";

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
