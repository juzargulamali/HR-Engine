"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildCrmStoragePath, fileExtension, inspectCrmFileBytes, validateCrmFileMeta } from "@enginious-hr/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";
import { friendlyCrmError } from "@/lib/crm/errors";

const BUCKET = "crm-files";
const purposeSchema = z.enum(["proposal", "purchase_order", "authorised_email", "brief", "other"]).default("other");

/**
 * Private upload. The browser never talks to storage: the file arrives here, is checked on the server (name, declared
 * type, size AND its own leading bytes — executables and macro-enabled Office files are refused), is stored with the
 * service role, and only then registered through crm_register_file(), which re-checks access, the path and that the
 * object exists. The table and the bucket repeat the type and size rules a third time.
 */
export async function uploadCrmFile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const opportunityId = z.string().uuid().safeParse(formData.get("id"));
  const file = formData.get("file");
  if (!opportunityId.success) return { error: "Missing opportunity." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  const purpose = purposeSchema.safeParse(formData.get("purpose") || undefined);
  if (!purpose.success) return { error: "Choose what the file is." };
  const label = String(formData.get("label") ?? "").trim() || null;

  const metaError = validateCrmFileMeta({ name: file.name, size: file.size, type: file.type });
  if (metaError) return { error: metaError };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentError = inspectCrmFileBytes(bytes, fileExtension(file.name));
  if (contentError) return { error: contentError };

  const supabase = await createClient();
  // Access check first: RLS only shows the opportunity to someone with a Sales grant for its company.
  const { data: opp } = await supabase.from("crm_opportunities").select("id, company_id").eq("id", opportunityId.data).maybeSingle();
  if (!opp) return { error: "Opportunity not found." };

  const path = buildCrmStoragePath(opp.company_id, opp.id, randomUUID(), file.name);
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) return { error: "The file could not be stored. Try again." };

  const { error } = await supabase.rpc("crm_register_file", {
    p_opportunity_id: opp.id, p_kind: "file", p_purpose: purpose.data, p_label: label, p_storage_path: path,
    p_original_name: file.name, p_mime_type: file.type, p_size_bytes: file.size,
  });
  if (error) {
    await admin.storage.from(BUCKET).remove([path]); // nothing registered, nothing left behind
    return { error: friendlyCrmError(error.message) };
  }
  revalidatePath(`/sales/opportunities/${opp.id}`);
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
