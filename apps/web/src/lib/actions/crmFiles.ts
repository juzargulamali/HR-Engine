"use server";

import { z } from "zod";
import { fileExtension, inspectCrmFileBytes, sanitizeCrmFileName, validateCrmFileMeta, CRM_MAX_FILE_BYTES } from "@enginious-hr/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { ActionState } from "./companies";
import { friendlyCrmError } from "@/lib/crm/errors";

const QUARANTINE = "crm-quarantine";
const BUCKET = "crm-files";
const purposeSchema = z.enum(["proposal", "purchase_order", "authorised_email", "brief", "other"]).default("other");

/**
 * PRIVATE UPLOAD, in two server steps around a direct browser upload.
 *
 * Why not post the file to a server action: Vercel serverless functions accept at most 4.5 MB of request body, so files
 * of the supported size (up to 20 MB) cannot pass through the app. Instead:
 *   1. prepareCrmUpload  — checks access and the declared name/type/size (same rules as the database), records an
 *      "upload intent", and returns a one-time signed URL for the PRIVATE quarantine bucket.
 *   2. the browser sends the bytes straight to that URL (not through Vercel). Nobody can read quarantine.
 *   3. finalizeCrmUpload — the server reads the object back, checks its REAL size and leading bytes (executables and
 *      macro-enabled Office files are refused), and only a file that passes is moved into the real private bucket and
 *      registered, using the intent's own stored values. A file that fails is deleted and never becomes available.
 * The table CHECKs and both buckets repeat the type and size rules a further time.
 */
export type PrepareUploadResult = { error: string } | { error: null; intentId: string; path: string; token: string };

export async function prepareCrmUpload(input: { opportunityId: string; name: string; size: number; type: string; purpose?: string; label?: string }): Promise<PrepareUploadResult> {
  const opportunityId = z.string().uuid().safeParse(input.opportunityId);
  if (!opportunityId.success) return { error: "Missing opportunity." };
  const purpose = purposeSchema.safeParse(input.purpose || undefined);
  if (!purpose.success) return { error: "Choose what the file is." };
  const metaError = validateCrmFileMeta({ name: input.name, size: input.size, type: input.type });
  if (metaError) return { error: metaError };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_create_upload_intent", {
    p_opportunity_id: opportunityId.data, p_original_name: input.name, p_mime_type: input.type, p_size_bytes: input.size,
    p_safe_name: sanitizeCrmFileName(input.name), p_purpose: purpose.data, p_label: input.label?.trim() || null,
  });
  const intent = data?.[0];
  if (error || !intent) return { error: friendlyCrmError(error?.message ?? "The upload could not be started.") };

  const { data: signed, error: signError } = await createAdminClient().storage.from(QUARANTINE).createSignedUploadUrl(intent.quarantine_path);
  if (signError || !signed) {
    // Nothing was uploaded; mark the intent rejected so it does not count against the person's open uploads.
    await createAdminClient().rpc("crm_mark_upload_intent", { p_intent_id: intent.intent_id, p_status: "rejected", p_reason: "could not sign upload url" });
    return { error: "The upload could not be started. Try again." };
  }
  return { error: null, intentId: intent.intent_id, path: intent.quarantine_path, token: signed.token };
}

async function rejectUpload(intentId: string, quarantinePath: string, reason: string): Promise<ActionState> {
  const admin = createAdminClient();
  await admin.storage.from(QUARANTINE).remove([quarantinePath]);
  await admin.rpc("crm_mark_upload_intent", { p_intent_id: intentId, p_status: "rejected", p_reason: reason });
  return { error: reason };
}

export async function finalizeCrmUpload(intentId: string): Promise<ActionState> {
  if (!z.string().uuid().safeParse(intentId).success) return { error: "Missing upload." };
  const supabase = await createClient();
  const { data: rows } = await supabase.rpc("crm_get_upload_intent", { p_intent_id: intentId });
  const intent = rows?.[0];
  if (!intent) return { error: "Upload not found." };
  if (intent.status !== "pending") return { error: intent.status === "registered" ? "This file was already added." : "This upload can no longer be used. Start again." };
  if (new Date(intent.expires_at).getTime() < Date.now()) return { error: "This upload expired. Start again." };

  const admin = createAdminClient();
  const { data: blob, error: downloadError } = await admin.storage.from(QUARANTINE).download(intent.quarantine_path);
  if (downloadError || !blob) return { error: "The file did not arrive. Try uploading it again." };

  // Check what actually arrived, not what the browser said.
  if (blob.size !== intent.size_bytes) return rejectUpload(intent.id, intent.quarantine_path, "The file was not the size it was declared to be.");
  if (blob.size > CRM_MAX_FILE_BYTES) return rejectUpload(intent.id, intent.quarantine_path, "That file is too large. The limit is 20 MB.");
  const metaError = validateCrmFileMeta({ name: intent.original_name, size: blob.size, type: intent.mime_type });
  if (metaError) return rejectUpload(intent.id, intent.quarantine_path, metaError);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const contentError = inspectCrmFileBytes(bytes, fileExtension(intent.original_name));
  if (contentError) return rejectUpload(intent.id, intent.quarantine_path, contentError);

  // Passed: move into the real private bucket, THEN mark validated (registration needs both), then remove quarantine.
  const { error: putError } = await admin.storage.from(BUCKET).upload(intent.final_path, bytes, { contentType: intent.mime_type, upsert: false });
  if (putError) return rejectUpload(intent.id, intent.quarantine_path, "The file could not be stored. Try again.");
  const { error: markError } = await admin.rpc("crm_mark_upload_intent", { p_intent_id: intent.id, p_status: "validated" });
  if (markError) {
    await admin.storage.from(BUCKET).remove([intent.final_path]);
    await admin.storage.from(QUARANTINE).remove([intent.quarantine_path]);
    return { error: "The upload expired. Start again." };
  }
  await admin.storage.from(QUARANTINE).remove([intent.quarantine_path]);

  const { error } = await supabase.rpc("crm_register_uploaded_file", { p_intent_id: intent.id });
  if (error) {
    await admin.storage.from(BUCKET).remove([intent.final_path]); // validated but could not be registered: leave nothing behind
    return { error: friendlyCrmError(error.message) };
  }
  revalidatePath(`/sales/opportunities/${intent.opportunity_id}`);
  revalidatePath("/sales", "layout");
  return { error: null };
}

export async function removeCrmFile(fileId: string): Promise<ActionState> {
  if (!z.string().uuid().safeParse(fileId).success) return { error: "Missing file." };
  const supabase = await createClient();
  const { data: file } = await supabase.from("crm_files").select("opportunity_id").eq("id", fileId).maybeSingle();
  const { data: path, error } = await supabase.rpc("crm_remove_file", { p_file_id: fileId });
  if (error) return { error: friendlyCrmError(error.message) };
  if (path) await createAdminClient().storage.from(BUCKET).remove([path]);
  if (file) revalidatePath(`/sales/opportunities/${file.opportunity_id}`);
  revalidatePath("/sales", "layout");
  return { error: null };
}

/** A short-lived link to a private file, issued only to someone RLS lets see the file's row. */
export async function getCrmFileUrl(fileId: string): Promise<{ url: string | null; error: string | null }> {
  if (!z.string().uuid().safeParse(fileId).success) return { url: null, error: "Missing file." };
  const supabase = await createClient();
  const { data: file } = await supabase.from("crm_files").select("storage_path, original_name, deleted_at").eq("id", fileId).maybeSingle();
  if (!file || file.deleted_at || !file.storage_path) return { url: null, error: "File not found." };
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(file.storage_path, 60, { download: file.original_name ?? true });
  if (error || !data) return { url: null, error: "The file could not be opened." };
  return { url: data.signedUrl, error: null };
}
