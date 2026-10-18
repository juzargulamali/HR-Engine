"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CRM_ALLOWED_FILE_SUMMARY, validateCrmFileMeta } from "@enginious-hr/domain";
import { addLink } from "@/lib/actions/crm";
import { finalizeCrmUpload, prepareCrmUpload } from "@/lib/actions/crmFiles";
import { createClient } from "@/lib/supabase/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ActionForm, Field } from "@/components/sales/action-form";
import { FILE_PURPOSES } from "./helpers";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,.txt,.csv";

/**
 * Upload a file or add a link. A file goes browser -> private quarantine storage (Vercel functions accept at most 4.5 MB of
 * request body, so it cannot pass through the app) and is then checked by the server; it only becomes available once it
 * passes. See lib/actions/crmFiles.ts.
 */
export function AddFileForms({ opportunityId }: { opportunityId: string }) {
  const [mode, setMode] = useState<"file" | "link">("file");
  return (
    <div className="space-y-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">How to add it</legend>
        {([["file", "Upload a file"], ["link", "Add a link"]] as const).map(([v, l]) => (
          <label key={v} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium", mode === v ? "border-accent bg-accent/10" : "border-border")}>
            <input type="radio" name="add-file-mode" checked={mode === v} onChange={() => setMode(v)} />
            {l}
          </label>
        ))}
      </fieldset>
      {mode === "file" ? (
        <UploadFileForm opportunityId={opportunityId} />
      ) : (
        <ActionForm action={addLink} submitLabel="Add link" resetOnSuccess>
          <input type="hidden" name="id" value={opportunityId} />
          <Field label="Link" htmlFor="ln-url" hint="Must start with https://. A link is only as private as its own sharing settings, which you control, not this system.">
            <Input id="ln-url" name="url" type="url" inputMode="url" required placeholder="https://" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What is it" htmlFor="ln-purpose">
              <Select id="ln-purpose" name="purpose" defaultValue="other">{FILE_PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
            </Field>
            <Field label="Label (optional)" htmlFor="ln-label"><Input id="ln-label" name="label" placeholder="e.g. Canva proposal" /></Field>
          </div>
        </ActionForm>
      )}
    </div>
  );
}

type Phase = "idle" | "checking" | "uploading" | "verifying";
const PHASE_TEXT: Record<Phase, string> = { idle: "", checking: "Checking the file…", uploading: "Uploading privately…", verifying: "Checking the file's contents…" };

function UploadFileForm({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    setError(null);
    setDone(null);
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file to upload.");
    const problem = validateCrmFileMeta({ name: file.name, size: file.size, type: file.type });
    if (problem) return setError(problem);
    try {
      setPhase("checking");
      const prepared = await prepareCrmUpload({ opportunityId, name: file.name, size: file.size, type: file.type, purpose: String(data.get("purpose") ?? "other"), label: String(data.get("label") ?? "") });
      if (prepared.error !== null) return setError(prepared.error);
      setPhase("uploading");
      const { error: uploadError } = await createClient().storage.from("crm-quarantine").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      if (uploadError) return setError("The upload did not complete. Check your connection and try again.");
      setPhase("verifying");
      const result = await finalizeCrmUpload(prepared.intentId);
      if (result.error) return setError(result.error);
      setDone(`${file.name} was added.`);
      form.reset();
      router.refresh();
    } catch {
      setError("Something went wrong while uploading. Try again.");
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="File" htmlFor="up-file" hint={`${CRM_ALLOWED_FILE_SUMMARY}; executables and macro-enabled files are refused. The file is stored privately and is only available after it has been checked.`}>
        <Input id="up-file" name="file" type="file" required accept={ACCEPT} disabled={busy} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What is it" htmlFor="up-purpose">
          <Select id="up-purpose" name="purpose" defaultValue="other" disabled={busy}>{FILE_PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
        </Field>
        <Field label="Label (optional)" htmlFor="up-label"><Input id="up-label" name="label" placeholder="e.g. Proposal v2, signed PO" disabled={busy} /></Field>
      </div>
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      {done ? <Alert role="status">{done}</Alert> : null}
      <div className="flex items-center justify-end gap-3">
        {busy ? <span role="status" className="text-sm text-muted-foreground">{PHASE_TEXT[phase]}</span> : null}
        <Button type="submit" disabled={busy}>{busy ? "Working…" : "Upload file"}</Button>
      </div>
    </form>
  );
}
