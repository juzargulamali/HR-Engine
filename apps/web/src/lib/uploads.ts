import "server-only";

/**
 * Every user-facing upload (identity documents, employee documents,
 * reimbursement receipts) shares this allowlist. The client-side
 * `<input accept="...">` on each form is a UX hint only — trivially
 * bypassed (devtools, or posting the FormData directly to the server
 * action) — so this is the real gate. Matches the `allowed_mime_types`/
 * `file_size_limit` now set on the corresponding storage buckets
 * (defense in depth: even a request that skipped this check would still
 * be rejected by Supabase Storage itself).
 */
export const ALLOWED_UPLOAD_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * Returns an error message if the file fails validation, or null if it's
 * fine to upload. Checking `file.type` (not the filename/extension) is
 * what lets the upload call force a matching, trusted Content-Type below —
 * an attacker naming a script `receipt.pdf` doesn't get a `.pdf`-shaped
 * Content-Type just because of the filename.
 */
export function validateUploadFile(file: File): string | null {
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "File is too large — the limit is 10 MB.";
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type as (typeof ALLOWED_UPLOAD_MIME_TYPES)[number])) {
    return "Only PDF, JPEG, PNG, or WebP files are allowed.";
  }
  return null;
}
