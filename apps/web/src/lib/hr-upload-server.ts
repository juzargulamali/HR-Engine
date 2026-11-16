import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { inspectUploadBytes, MAX_UPLOAD_BYTES, UPLOAD_NOT_ARRIVED, validateUploadMeta, type DeclaredFile, type PrepareUploadResult, type UploadBucket } from "./upload-rules";

/**
 * The two private-storage steps every People & HR upload shares (employee documents, identity scans, insurance documents, receipts). They are called ONLY after the calling
 * action has authorised the person for the employee (or claim) from the database and has built the storage path itself from the employee record and a one-time submission id:
 * nothing here accepts a path or company from a browser.
 *
 *  - signHrUpload: hands out a one-time signed upload link for that exact path in the existing private bucket. If the file is already there (a retry after a lost answer) it
 *    says so instead of signing, so the browser skips the upload and goes straight to the check.
 *  - readBackHrUpload: after the browser has sent the file, reads it back and checks its REAL size and leading bytes against what was declared. A file that fails is deleted
 *    on the spot, so nothing that failed a check is ever left in the bucket or linked to a record.
 */
export async function signHrUpload(bucket: UploadBucket, path: string): Promise<PrepareUploadResult> {
  const storage = createAdminClient().storage.from(bucket);
  try {
    const there = await storage.exists(path);
    if (there.data === true) return { error: null, bucket, path, token: null };
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data) return { error: "The upload could not be started. Try again." };
    return { error: null, bucket, path, token: data.token };
  } catch {
    return { error: "The upload could not be started. Try again." };
  }
}

export async function discardHrUpload(bucket: UploadBucket, path: string): Promise<void> {
  await createAdminClient().storage.from(bucket).remove([path]);
}

export async function readBackHrUpload(bucket: UploadBucket, path: string, declared: DeclaredFile): Promise<{ error: string } | { error: null }> {
  const { data: blob, error } = await createAdminClient().storage.from(bucket).download(path);
  if (error || !blob) return { error: UPLOAD_NOT_ARRIVED };
  const fail = async (message: string) => { await discardHrUpload(bucket, path); return { error: message }; };
  if (blob.size !== declared.size) return fail("The file was not the size it was declared to be. Choose it again.");
  if (blob.size > MAX_UPLOAD_BYTES) return fail("That file is too large. The limit is 10 MB.");
  const metaError = validateUploadMeta({ name: declared.name, size: blob.size, type: declared.type });
  if (metaError) return fail(metaError);
  const contentError = inspectUploadBytes(new Uint8Array(await blob.arrayBuffer()), declared.type);
  if (contentError) return fail(contentError);
  return { error: null };
}
