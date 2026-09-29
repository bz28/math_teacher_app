import * as ImageManipulator from "expo-image-manipulator";
import { cacheDirectory, deleteAsync, EncodingType, writeAsStringAsync } from "expo-file-system/legacy";

/**
 * A small copy of a staged page for the server's "looks sideways?"
 * check — enough pixels to see which way the writing runs, a fraction
 * of the upload. Returns raw base64 JPEG.
 */
export async function orientationCheckCopy(base64: string): Promise<string> {
  const path = `${cacheDirectory}orientation-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  await writeAsStringAsync(path, base64, { encoding: EncodingType.Base64 });
  try {
    const small = await ImageManipulator.manipulateAsync(
      path,
      [{ resize: { width: 1024 } }],
      { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.8 },
    );
    if (!small.base64) throw new Error("Image conversion returned no base64 data");
    return small.base64;
  } finally {
    await deleteAsync(path, { idempotent: true });
  }
}
