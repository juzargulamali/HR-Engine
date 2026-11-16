import { fileExtension, inspectCrmFileBytes, validateCrmFileMeta } from "@enginious-hr/domain";

/**
 * The one set of rules for every People & HR upload (employee documents, identity scans, insurance documents, reimbursement receipts). It is plain code with no server-only
 * imports on purpose: the form checks a file with it BEFORE anything is sent, the server checks the declared name, type and size again before it hands out an upload link,
 * and the server checks the real bytes again after the file has arrived. The four private buckets repeat the type and size limit a last time.
 *
 * What the screens say ("PDF, JPEG, PNG or WebP, up to 10 MB") is exactly what these constants enforce, on every path.
 */
export const ALLOWED_UPLOAD_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB: keep in step with file_size_limit on the four buckets
/** The sentence shown under every file field. */
export const UPLOAD_LIMIT_TEXT = "PDF, JPEG, PNG or WebP, up to 10 MB.";
/** What a file picker offers (a hint only; the rules below are the gate). */
export const UPLOAD_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

export type UploadBucket = "employee-documents" | "identity-documents" | "insurance-documents" | "receipts";

/** What a "prepare" step answers. `token` is null when the file is already in storage (a retry): the browser then skips the upload and goes straight to the check. */
export type PrepareUploadResult = { error: string } | { error: null; bucket: UploadBucket; path: string; token: string | null };

export const UPLOAD_SEND_FAILED = "The file could not be uploaded. Check your connection and try again.";
export const UPLOAD_NOT_ARRIVED = "The file did not arrive. Try uploading it again.";
export const UPLOAD_PAGE_OUT_OF_DATE = "This page is out of date. Reload it and try again.";

const EXT_FOR_TYPE: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export interface DeclaredFile { name: string; size: number; type: string }

/** Name, declared type and size only (no bytes). Returns the sentence to show, or null when the file may be sent. */
export function validateUploadMeta(file: DeclaredFile): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) return "The file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "That file is too large. The limit is 10 MB.";
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type as (typeof ALLOWED_UPLOAD_MIME_TYPES)[number])) return "Only PDF, JPEG, PNG, or WebP files are allowed.";
  // Name rules (length, executable and macro names, double extensions, the extension matching the type) are the ones Sales and Projects use.
  const nameProblem = validateCrmFileMeta(file);
  if (nameProblem) return nameProblem.startsWith("That file type is not allowed") ? "Only PDF, JPEG, PNG, or WebP files are allowed." : nameProblem;
  return null;
}

/** Checks what actually arrived: the leading bytes must be the kind of file that was declared, and never an executable. */
export function inspectUploadBytes(bytes: Uint8Array, declaredType: string): string | null {
  const ext = EXT_FOR_TYPE[declaredType];
  if (!ext) return "Only PDF, JPEG, PNG, or WebP files are allowed.";
  return inspectCrmFileBytes(bytes, ext);
}

export { fileExtension };

/**
 * Every storage path is `<trusted-uuid-segments>/<this>`, and each bucket's access rules key only off those leading segments, so an unsanitised name could not leave them;
 * every raw file name (and the document type used the same way) is still cleaned before going into a path.
 */
export function sanitizeForStoragePath(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}
