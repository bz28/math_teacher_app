import * as ImageManipulator from "expo-image-manipulator";

/** Convert image URI to base64 JPEG (no cropping). */
export async function imageToBase64(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [],
    { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.7 },
  );
  if (!result.base64) throw new Error("Image conversion returned no base64 data");
  return result.base64;
}
