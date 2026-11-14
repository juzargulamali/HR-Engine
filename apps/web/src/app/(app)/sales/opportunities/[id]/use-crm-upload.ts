"use client";

import { useCallback, useState } from "react";
import { CRM_ALLOWED_FILE_SUMMARY, validateCrmFileMeta } from "@enginious-hr/domain";
import { finalizeCrmUpload, prepareCrmUpload } from "@/lib/actions/crmFiles";
import { createClient } from "@/lib/supabase/client";

/**
 * The ONE private upload path for an enquiry's files, shared by "Add a file or link" and "Add proposal version" so both apply exactly the same checks and
 * storage: the name, type and size are checked in the browser and again by the server (validateCrmFileMeta), the bytes go straight to the private quarantine
 * bucket (a Vercel function accepts at most 4.5 MB, so they cannot pass through the app), and the server then checks what actually arrived before the file is
 * registered on the enquiry. See lib/actions/crmFiles.ts. Nothing here decides a rule.
 */
export const CRM_FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,.txt,.csv";
/** What may be uploaded, said once behind the ⓘ beside a file field. */
export const FILE_RULES_HELP = `Allowed: ${CRM_ALLOWED_FILE_SUMMARY}. Executables and macro-enabled files are refused. The file is stored privately and is only available after it has been checked.`;

export type UploadPhase = "idle" | "checking" | "uploading" | "verifying";
export const UPLOAD_PHASE_TEXT: Record<UploadPhase, string> = { idle: "", checking: "Checking the file…", uploading: "Uploading privately…", verifying: "Checking the file's contents…" };

/** `fileId` is the registered file (null only if the server did not return it: the file is then on the enquiry all the same). */
export type UploadResult = { error: string } | { error: null; fileId: string | null };

export async function uploadCrmFile(input: { opportunityId: string; file: File | null; purpose: string; label: string }, onPhase: (p: UploadPhase) => void = () => {}): Promise<UploadResult> {
  const { file } = input;
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  const problem = validateCrmFileMeta({ name: file.name, size: file.size, type: file.type });
  if (problem) return { error: problem };
  try {
    onPhase("checking");
    const prepared = await prepareCrmUpload({ opportunityId: input.opportunityId, name: file.name, size: file.size, type: file.type, purpose: input.purpose, label: input.label });
    if (prepared.error !== null) return { error: prepared.error };
    onPhase("uploading");
    const { error: uploadError } = await createClient().storage.from("crm-quarantine").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
    if (uploadError) return { error: "The upload did not complete. Check your connection and try again." };
    onPhase("verifying");
    const result = await finalizeCrmUpload(prepared.intentId);
    if (result.error) return { error: result.error };
    return { error: null, fileId: result.fileId ?? null };
  } catch {
    return { error: "Something went wrong while uploading. Try again." };
  } finally {
    onPhase("idle");
  }
}

/** The upload with its progress words, for a form. The caller keeps the error it shows (a rejected file's reason stays on screen until the next attempt). */
export function useCrmUpload(opportunityId: string) {
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const upload = useCallback((file: File | null, purpose: string, label = "") => uploadCrmFile({ opportunityId, file, purpose, label }, setPhase), [opportunityId]);
  return { phase, busy: phase !== "idle", phaseText: UPLOAD_PHASE_TEXT[phase], upload };
}
