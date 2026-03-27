import { Alert, Linking } from "react-native";
import * as ImagePicker from "expo-image-picker";

export async function requestCameraAccess(): Promise<boolean> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== "granted") {
    Alert.alert(
      "Camera Access Required",
      "Please enable camera access in Settings to scan problems.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ],
    );
    return false;
  }
  return true;
}

export async function requestGalleryAccess(): Promise<boolean> {
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
    return false;
  }
  return true;
}
