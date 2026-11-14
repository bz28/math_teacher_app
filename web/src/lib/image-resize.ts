/**
 * Client-side image prep for homework submission.
 *
 * Hybrid strategy:
 *   - <= 5 MB → pass through untouched. Preserves original fidelity
 *     (PNG scans stay lossless, teacher sees the exact photo the
 *     student submitted). Saves ~200 ms of bitmap + re-encode on the
 *     common case.
 *   - >  5 MB → re-encode as JPEG to fit under the server cap,
 *     keeping as much resolution as fits: first at full size (capped
 *     at 4096px), then at the reader's 2576px, then 2048px. The
 *     drawing check zooms into the ORIGINAL pixels, so every pixel
 *     dropped here is one the teacher's graph check never sees.
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

// Largest first, so a photo that fits keeps its resolution. 4096 covers
// a 12MP phone photo (4032px) at full size; 2576 is the long edge the
// homework reader reads natively (READER_MAX_EDGE in
// api/core/image_utils.py); 2048 is the floor — below it, handwritten
// math and graph detail start to blur, and we'd rather say so than
// silently chew the image.
export const ATTEMPTS: readonly Attempt[] = [
  { maxDim: 4096, quality: 0.85 },
  { maxDim: 2576, quality: 0.85 },
  { maxDim: 2048, quality: 0.8 },
];

/** Output size for `maxDim`: the long edge capped at it, aspect kept,
 *  never upscaled. */
export function scaledSize(
  width: number,
  height: number,
  maxDim: number,
): { width: number; height: number } {
  const scale = Math.min(maxDim / width, maxDim / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The attempts worth encoding for a `width`×`height` photo, in order.
 *  One that would produce the same pixels at no lower quality than the
 *  one before is skipped — a 2400px photo is the same image at the 4096
 *  and 2576 caps, and encoding it twice would only double the wait. */
export function plannedAttempts(width: number, height: number): Attempt[] {
  const out: Attempt[] = [];
  let prev: { width: number; height: number; quality: number } | null = null;
  for (const attempt of ATTEMPTS) {
    const size = scaledSize(width, height, attempt.maxDim);
    if (
      prev &&
      prev.width === size.width &&
      prev.height === size.height &&
      attempt.quality >= prev.quality
    ) {
      continue;
    }
    out.push(attempt);
    prev = { ...size, quality: attempt.quality };
  }
  return out;
}

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
    for (const attempt of plannedAttempts(bitmap.width, bitmap.height)) {
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

/** The smallest homework photo worth reading, by its long edge. Mirrors
 *  MIN_PAGE_LONG_EDGE in api/core/image_utils.py, which refuses smaller
 *  pages: at 320×240 the reader can't see the ink and invents a tidy
 *  solution instead. */
export const MIN_PAGE_LONG_EDGE = 400;

/** Throws `ImageResizeError` when a homework page is too small to read,
 *  so the student retakes it now instead of the server refusing it at
 *  turn-in. */
export async function assertPageReadable(blob: Blob): Promise<void> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    // Older iPads lack createImageBitmap, and a large photo can run iOS
    // out of memory. Neither means the page is unreadable — the server
    // measures it at turn-in and has the final say.
    return;
  }
  const longEdge = Math.max(bitmap.width, bitmap.height);
  bitmap.close?.();
  if (longEdge < MIN_PAGE_LONG_EDGE) {
    throw new ImageResizeError(
      "This photo is too small to read. Take it again closer up, so the page fills the screen.",
    );
  }
}

/**
 * A small copy of a page for the server's "looks sideways?" check —
 * enough pixels to see which way the writing runs, a fraction of the
 * upload. `createImageBitmap` applies the photo's EXIF orientation, so
 * the check sees the page the way the student's preview shows it.
 * Returns raw base64 (no data: prefix).
 */
export async function orientationCheckCopy(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const small = await drawScaledJpeg(bitmap, { maxDim: 1024, quality: 0.8 });
    const dataUrl = await blobToDataUrl(small);
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  } finally {
    bitmap.close?.();
  }
}

async function drawScaledJpeg(
  bitmap: ImageBitmap,
  attempt: Attempt,
): Promise<Blob> {
  const { width, height } = scaledSize(bitmap.width, bitmap.height, attempt.maxDim);

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new ImageResizeError(
        "Your browser couldn't prepare the image. Try a different browser.",
      );
    }
    // JPEG has no alpha: paint white first, or a transparent PNG's
    // background encodes as black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
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
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
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
