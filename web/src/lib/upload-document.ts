import { teacher } from "@/lib/api";
import { MATERIAL_UPLOAD_MAX_BYTES } from "@/lib/constants";
import { fileToBase64 } from "@/lib/utils";

/**
 * Upload one document to a course. Validates client-side size, base64-
 * encodes, and POSTs through the existing teacher.uploadDocument API.
 * Returns the new document id so callers can auto-select or refetch.
 *
 * Shared between the Materials tab (which orchestrates folder/multi-
 * file imports on top of this) and the source-material picker on the
 * New Homework / New Practice wizards (which uploads single files
 * inline). Keeping the size check + base64 encode in one place stops
 * the two call sites from drifting on validation.
 */
export async function uploadDocument(
  courseId: string,
  file: File,
  unitId: string,
): Promise<string> {
  if (file.size > MATERIAL_UPLOAD_MAX_BYTES) throw new Error("exceeds 25MB");
  const base64 = await fileToBase64(file);
  const resp = await teacher.uploadDocument(courseId, {
    image_base64: base64,
    filename: file.name,
    unit_id: unitId,
  });
  return resp.id;
}
