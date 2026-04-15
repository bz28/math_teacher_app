/**
 * Client-side image prep for homework submission.
 *
 * Hybrid strategy:
 *   - <= 5 MB → pass through untouched. Preserves original fidelity
 *     (PNG scans stay lossless, teacher sees the exact photo the
 *     student submitted). Saves ~200 ms of bitmap + re-encode on the
 *     common case.
 *   - >  5 MB → resize + re-encode as JPEG to fit under the server
 *     cap. Progressively smaller attempts if the first pass still
 *     exceeds the cap.
 *   - > MAX_INPUT_BYTES → reject outright. A 25 MB input is almost
 *     always a mis-picked file (video, DSLR raw, etc.), not a real
 *     homework photo; fail fast with a clear message.
 *
 * Prefers OffscreenCanvas (Safari ≥16.4 / Chrome / Firefox). Falls
 * back to a regular HTMLCanvasElement when unavailable.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

type Attempt = { maxDim: number; quality: number };

// Start at the conservative default; shrink if the first pass still
// exceeds the server cap (rare). Third attempt is the floor — below
// this resolution, handwritten math legibility starts to suffer and we
// should surface an error instead of silently chewing the image.
const ATTEMPTS: readonly Attempt[] = [
  { maxDim: 2048, quality: 0.85 },
  { maxDim: 1600, quality: 0.75 },
  { maxDim: 1280, quality: 0.7 },
];

export class ImageResizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageResizeError";
  }
}

/**
 * Prepare `file` for upload. Returns the original File untouched when
 * it already fits under the server cap, or a resized JPEG blob when
 * resizing was needed. Throws `ImageResizeError` with a user-facing
 * message on failure.
 */
export async function resizeImageForUpload(file: File): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageResizeError(
      "That file is too large. Pick a photo of your homework, not a video or a scan of the whole textbook.",
    );
  }
  if (file.size <= MAX_BYTES) {
    // Fast path: no bitmap decode, no re-encode, original preserved.
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    throw new ImageResizeError(
      e instanceof Error
        ? `Couldn't read that image (${e.message}). Try a different photo.`
        : "Couldn't read that image. Try a different photo.",
    );
  }

  try {
    for (const attempt of ATTEMPTS) {
      const blob = await drawScaledJpeg(bitmap, attempt);
      if (blob.size <= MAX_BYTES) return blob;
    }
    throw new ImageResizeError(
      "Couldn't shrink that image below 5 MB. Try a cleaner photo or crop it.",
    );
  } finally {
    // Release the GPU-backed bitmap. Safe to call even if the browser
    // hasn't uploaded it to the GPU yet.
    bitmap.close?.();
  }
}

async function drawScaledJpeg(
  bitmap: ImageBitmap,
  attempt: Attempt,
): Promise<Blob> {
  const scale = Math.min(
    attempt.maxDim / bitmap.width,
    attempt.maxDim / bitmap.height,
    1, // never upscale
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new ImageResizeError(
        "Your browser couldn't prepare the image. Try a different browser.",
      );
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: "image/jpeg", quality: attempt.quality });
  }

  // HTMLCanvasElement fallback (older Safari, unusual environments).
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ImageResizeError(
      "Your browser couldn't prepare the image. Try a different browser.",
    );
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new ImageResizeError("Image encoding failed. Try again."));
      },
      "image/jpeg",
      attempt.quality,
    );
  });
}

/**
 * Convert a Blob into a `data:image/...;base64,...` data URL that the
 * server's submit endpoint accepts end-to-end.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new ImageResizeError("Couldn't read the resized image."));
    reader.readAsDataURL(blob);
  });
}
