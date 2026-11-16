import "server-only";
import { MAX_UPLOAD_BYTES, validateUploadMeta } from "./upload-rules";

/**
 * The rules for every user-facing People & HR upload now live in ./upload-rules (shared by the forms, which check a file before sending it, and by the server actions).
 * This module keeps the older `File`-based entry point and the constants under their old names.
 */
export { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES, sanitizeForStoragePath } from "./upload-rules";

/** Returns an error message if the file fails validation, or null if it is fine to upload. Checks the declared type and size, never the filename alone. */
export function validateUploadFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return "File is too large — the limit is 10 MB.";
  return validateUploadMeta({ name: file.name, size: file.size, type: file.type });
}
