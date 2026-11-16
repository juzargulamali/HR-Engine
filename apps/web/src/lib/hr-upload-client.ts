import { createClient } from "@/lib/supabase/client";
import { UPLOAD_SEND_FAILED, validateUploadMeta, type PrepareUploadResult } from "./upload-rules";

/**
 * The browser half of a private upload: sends the bytes straight to the private bucket with the one-time link the server's "prepare" step handed back (a Vercel function
 * accepts at most 4.5 MB of request body, and a Next.js action 1 MB unless raised, so a real scan cannot go through the app). Returns the sentence to show, or null on success.
 * When the server says the file is already stored (a retry), nothing is sent.
 */
export async function sendHrFile(prepared: Extract<PrepareUploadResult, { error: null }>, file: File): Promise<string | null> {
  if (prepared.token === null) return null;
  try {
    const { error } = await createClient().storage.from(prepared.bucket).uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
    return error ? UPLOAD_SEND_FAILED : null;
  } catch {
    return UPLOAD_SEND_FAILED;
  }
}

/**
 * The whole browser side for a form with an optional file: checks the file against the displayed limits (so a wrong file is refused beside the field before anything is sent),
 * asks the server to authorise and prepare the upload, then sends the bytes. Returns the sentence to show, or null when there is no file or it is now safely in private
 * storage (the form then saves its record, which checks the stored file again). `prepare` is the form's own "prepare" server action.
 */
export async function uploadChosenFile(file: File | null, prepare: (declared: { name: string; size: number; type: string }) => Promise<PrepareUploadResult>): Promise<string | null> {
  if (!file) return null;
  const problem = validateUploadMeta({ name: file.name, size: file.size, type: file.type });
  if (problem) return problem;
  try {
    const prepared = await prepare({ name: file.name, size: file.size, type: file.type });
    if (prepared.error !== null) return prepared.error;
    return await sendHrFile(prepared, file);
  } catch {
    return "Something went wrong while uploading. Try again.";
  }
}
