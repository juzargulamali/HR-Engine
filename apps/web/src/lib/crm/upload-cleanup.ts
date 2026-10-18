import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface UploadCleanupResult {
  intentsSwept: number;
  quarantineObjectsRemoved: number;
  orphanedValidatedRemoved: number;
  failures: number;
}

/**
 * Scheduled clean-up of private uploads. Every upload intent is swept once, after its one-time upload URL has expired:
 * the quarantine object (which a replayed URL could have refilled) is deleted, and so is a file that passed validation
 * but was never registered. Nothing registered is ever touched (crm_expire_upload_intents only returns the paths of
 * intents, and never lists the final path of a registered file as removable).
 */
export async function purgeExpiredUploads(): Promise<UploadCleanupResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("crm_expire_upload_intents");
  if (error) throw new Error(`crm_expire_upload_intents failed: ${error.message}`);
  const out: UploadCleanupResult = { intentsSwept: 0, quarantineObjectsRemoved: 0, orphanedValidatedRemoved: 0, failures: 0 };
  for (const row of data ?? []) {
    out.intentsSwept++;
    const q = await admin.storage.from("crm-quarantine").remove([row.quarantine_path]);
    if (q.error) out.failures++; else out.quarantineObjectsRemoved++;
    if (row.orphaned_validated) {
      const f = await admin.storage.from("crm-files").remove([row.final_path]);
      if (f.error) out.failures++; else out.orphanedValidatedRemoved++;
    }
  }
  return out;
}
