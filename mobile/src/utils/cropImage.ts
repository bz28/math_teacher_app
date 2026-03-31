import * as ImageManipulator from "expo-image-manipulator";

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Crop a region from an image URI. Returns base64 JPEG string. */
export async function cropImage(uri: string, region: CropRegion): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop: { originX: region.x, originY: region.y, width: region.width, height: region.height } }],
    { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.7 },
  );
  if (!result.base64) throw new Error("Crop returned no base64 data");
  return result.base64;
}
