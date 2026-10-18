"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fileExtension, inspectCrmFileBytes, sanitizeCrmFileName, validateCrmFileMeta, CRM_MAX_FILE_BYTES } from "@enginious-hr/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkbox, fail, firstIssue, ok, optionalText, refreshProjects, uuid, type ProjectActionState } from "@/lib/projects/action-utils";
import { friendlyProjectError } from "@/lib/projects/errors";

const QUARANTINE = "proj-quarantine";
const BUCKET = "proj-files";
const purposeSchema = z.enum(["document", "completion_evidence", "feedback_evidence", "other"]).default("document");
type S = ProjectActionState;

/**
 * PRIVATE UPLOAD, in two server steps around a direct browser upload (the same design as the Sales files; see
 * lib/actions/crmFiles.ts): prepare (access and declared type/size checked in the database, one-time signed URL for the private
 * quarantine bucket), the browser sends the bytes straight there, then finalize (the server reads the object back, checks its REAL
 * size and leading bytes, moves a passing file into the private bucket and registers it from the intent's own stored values).
 * Nobody can read a file that has not been validated, and every download re-checks access through RLS.
 */
export type PrepareProjectUploadResult = { error: string } | { error: null; intentId: string; path: string; token: string };

export async function prepareProjectUpload(input: { projectId: string; name: string; size: number; type: string; purpose?: string; label?: string; restricted?: boolean }): Promise<PrepareProjectUploadResult> {
  const projectId = uuid.safeParse(input.projectId);
  if (!projectId.success) return { error: "Missing project." };
  const purpose = purposeSchema.safeParse(input.purpose || undefined);
  if (!purpose.success) return { error: "Choose what the file is." };
  const metaError = validateCrmFileMeta({ name: input.name, size: input.size, type: input.type });
  if (metaError) return { error: metaError };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_create_upload_intent", {
    p_project_id: projectId.data, p_original_name: input.name, p_mime_type: input.type, p_size_bytes: input.size,
    p_safe_name: sanitizeCrmFileName(input.name), p_purpose: purpose.data, p_label: input.label?.trim() || null, p_restricted: Boolean(input.restricted),
  });
  const intent = data?.[0];
  if (error || !intent) return { error: friendlyProjectError(error?.message ?? "The upload could not be started.") };
  const { data: signed, error: signError } = await createAdminClient().storage.from(QUARANTINE).createSignedUploadUrl(intent.quarantine_path);
  if (signError || !signed) {
    await createAdminClient().rpc("proj_mark_upload_intent", { p_intent_id: intent.intent_id, p_status: "rejected", p_reason: "could not sign upload url" });
    return { error: "The upload could not be started. Try again." };
  }
  return { error: null, intentId: intent.intent_id, path: intent.quarantine_path, token: signed.token };
}

async function rejectUpload(intentId: string, quarantinePath: string, reason: string): Promise<S> {
  const admin = createAdminClient();
  await admin.storage.from(QUARANTINE).remove([quarantinePath]);
  await admin.rpc("proj_mark_upload_intent", { p_intent_id: intentId, p_status: "rejected", p_reason: reason });
  return { error: reason };
}

export async function finalizeProjectUpload(intentId: string): Promise<S> {
  if (!uuid.safeParse(intentId).success) return { error: "Missing upload." };
  const supabase = await createClient();
  const { data: rows } = await supabase.rpc("proj_get_upload_intent", { p_intent_id: intentId });
  const intent = rows?.[0];
  if (!intent) return { error: "Upload not found." };
  if (intent.status !== "pending") return { error: intent.status === "registered" ? "This file was already added." : "This upload can no longer be used. Start again." };
  if (new Date(intent.expires_at).getTime() < Date.now()) return { error: "This upload expired. Start again." };

  const admin = createAdminClient();
  const { data: blob, error: downloadError } = await admin.storage.from(QUARANTINE).download(intent.quarantine_path);
  if (downloadError || !blob) return { error: "The file did not arrive. Try uploading it again." };
  if (blob.size !== intent.size_bytes) return rejectUpload(intent.id, intent.quarantine_path, "The file was not the size it was declared to be.");
  if (blob.size > CRM_MAX_FILE_BYTES) return rejectUpload(intent.id, intent.quarantine_path, "That file is too large. The limit is 20 MB.");
  const metaError = validateCrmFileMeta({ name: intent.original_name, size: blob.size, type: intent.mime_type });
  if (metaError) return rejectUpload(intent.id, intent.quarantine_path, metaError);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const contentError = inspectCrmFileBytes(bytes, fileExtension(intent.original_name));
  if (contentError) return rejectUpload(intent.id, intent.quarantine_path, contentError);

  const { error: putError } = await admin.storage.from(BUCKET).upload(intent.final_path, bytes, { contentType: intent.mime_type, upsert: false });
  if (putError) return rejectUpload(intent.id, intent.quarantine_path, "The file could not be stored. Try again.");
  const { error: markError } = await admin.rpc("proj_mark_upload_intent", { p_intent_id: intent.id, p_status: "validated" });
  if (markError) {
    await admin.storage.from(BUCKET).remove([intent.final_path]);
    await admin.storage.from(QUARANTINE).remove([intent.quarantine_path]);
    return { error: "The upload expired. Start again." };
  }
  await admin.storage.from(QUARANTINE).remove([intent.quarantine_path]);
  const { data: fileId, error } = await supabase.rpc("proj_register_uploaded_file", { p_intent_id: intent.id });
  if (error) {
    await admin.storage.from(BUCKET).remove([intent.final_path]);
    return { error: friendlyProjectError(error.message) };
  }
  refreshProjects(intent.project_id);
  return ok(fileId);
}

export async function addProjectLink(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, url: z.string().trim().url("Enter a valid link").regex(/^https:\/\//i, "Links must start with https://"), label: optionalText, purpose: purposeSchema, restricted: checkbox }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_add_link", { p_project_id: p.data.projectId, p_label: p.data.label ?? "", p_url: p.data.url, p_purpose: p.data.purpose, p_restricted: p.data.restricted });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok(data);
}

export async function removeProjectFile(fileId: string): Promise<S> {
  if (!uuid.safeParse(fileId).success) return { error: "Missing file." };
  const supabase = await createClient();
  const { data: file } = await supabase.from("proj_files").select("project_id").eq("id", fileId).maybeSingle();
  const { data: path, error } = await supabase.rpc("proj_remove_file", { p_file_id: fileId });
  if (error) return { error: friendlyProjectError(error.message) };
  if (path) await createAdminClient().storage.from(BUCKET).remove([path]);
  if (file) revalidatePath(`/projects/${file.project_id}`, "layout");
  return { error: null };
}

/** A short-lived link to a private file, issued only to someone RLS lets see the file's row (so a removed member gets nothing). */
export async function getProjectFileUrl(fileId: string): Promise<{ url: string | null; error: string | null }> {
  if (!uuid.safeParse(fileId).success) return { url: null, error: "Missing file." };
  const supabase = await createClient();
  const { data: file } = await supabase.from("proj_files").select("storage_path, original_name, url, deleted_at").eq("id", fileId).maybeSingle();
  if (!file || file.deleted_at) return { url: null, error: "File not found." };
  if (file.url) return { url: file.url, error: null };
  if (!file.storage_path) return { url: null, error: "File not found." };
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(file.storage_path, 60, { download: file.original_name ?? true });
  if (error || !data) return { url: null, error: "The file could not be opened." };
  return { url: data.signedUrl, error: null };
}
