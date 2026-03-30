export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Crop a region from a base64 image using an off-screen canvas. Returns base64 JPEG. */
export function cropImage(base64: string, region: CropRegion): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = region.width;
      canvas.height = region.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context not available"));
        return;
      }
      ctx.drawImage(
        img,
        region.x, region.y, region.width, region.height,
        0, 0, region.width, region.height,
      );
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}
