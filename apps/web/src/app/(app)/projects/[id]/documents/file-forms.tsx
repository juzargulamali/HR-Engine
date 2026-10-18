"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CRM_ALLOWED_FILE_SUMMARY, validateCrmFileMeta } from "@enginious-hr/domain";
import { addProjectLink, finalizeProjectUpload, getProjectFileUrl, prepareProjectUpload, removeProjectFile } from "@/lib/actions/projectsFiles";
import { createClient } from "@/lib/supabase/client";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,.txt,.csv";

export const FILE_PURPOSES = [
  { id: "document", label: "Document" },
  { id: "feedback_evidence", label: "Feedback evidence" },
  { id: "completion_evidence", label: "Completion evidence (Project Manager)" },
  { id: "other", label: "Other" },
] as const;

function PurposeSelect({ id, isManager, disabled }: { id: string; isManager: boolean; disabled?: boolean }) {
  return (
    <Select id={id} name="purpose" defaultValue="document" disabled={disabled}>
      {FILE_PURPOSES.filter((p) => isManager || p.id !== "completion_evidence").map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
    </Select>
  );
}

/**
 * Upload a file or add a link. A file goes browser -> private quarantine storage (Vercel functions accept at most 4.5 MB of request
 * body) and is then checked by the server; it only becomes available once it passes. See lib/actions/projectsFiles.ts.
 */
export function AddFileForms({ projectId, isManager }: { projectId: string; isManager: boolean }) {
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
        <UploadFileForm projectId={projectId} isManager={isManager} />
      ) : (
        <ActionForm action={addProjectLink} submitLabel="Add link" resetOnSuccess>
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="Link" htmlFor="pl-url" hint="Must start with https://. A link is only as private as its own sharing settings, which you control, not this system.">
            <Input id="pl-url" name="url" type="url" inputMode="url" required placeholder="https://" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What is it" htmlFor="pl-purpose"><PurposeSelect id="pl-purpose" isManager={isManager} /></Field>
            <Field label="Label (optional)" htmlFor="pl-label"><Input id="pl-label" name="label" placeholder="e.g. Moodboard on Miro" /></Field>
          </div>
          {isManager ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restricted" /> Restricted: only the Project Manager and founders can see it</label> : null}
        </ActionForm>
      )}
    </div>
  );
}

type Phase = "idle" | "checking" | "uploading" | "verifying";
const PHASE_TEXT: Record<Phase, string> = { idle: "", checking: "Checking the file…", uploading: "Uploading privately…", verifying: "Checking the file's contents…" };

function UploadFileForm({ projectId, isManager }: { projectId: string; isManager: boolean }) {
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
      const prepared = await prepareProjectUpload({ projectId, name: file.name, size: file.size, type: file.type, purpose: String(data.get("purpose") ?? "document"), label: String(data.get("label") ?? ""), restricted: data.get("restricted") === "on" });
      if (prepared.error !== null) return setError(prepared.error);
      setPhase("uploading");
      const { error: uploadError } = await createClient().storage.from("proj-quarantine").uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      if (uploadError) return setError("The upload did not complete. Check your connection and try again.");
      setPhase("verifying");
      const result = await finalizeProjectUpload(prepared.intentId);
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
      <Field label="File" htmlFor="pu-file" hint={`${CRM_ALLOWED_FILE_SUMMARY}; executables and macro-enabled files are refused. The file is stored privately and is only available after it has been checked.`}>
        <Input id="pu-file" name="file" type="file" required accept={ACCEPT} disabled={busy} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What is it" htmlFor="pu-purpose"><PurposeSelect id="pu-purpose" isManager={isManager} disabled={busy} /></Field>
        <Field label="Label (optional)" htmlFor="pu-label"><Input id="pu-label" name="label" placeholder="e.g. Signed handover" disabled={busy} /></Field>
      </div>
      {isManager ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restricted" disabled={busy} /> Restricted: only the Project Manager and founders can see it</label> : null}
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      {done ? <Alert role="status">{done}</Alert> : null}
      <div className="flex items-center justify-end gap-3">
        {busy ? <span role="status" className="text-sm text-muted-foreground">{PHASE_TEXT[phase]}</span> : null}
        <Button type="submit" disabled={busy}>{busy ? "Working…" : "Upload file"}</Button>
      </div>
    </form>
  );
}

/** Opens a file or link through a short-lived URL issued only if the database still lets this person see it. */
export function OpenFileButton({ fileId }: { fileId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        const res = await getProjectFileUrl(fileId);
        setBusy(false);
        if (res.error || !res.url) return setError(res.error ?? "The file could not be opened.");
        window.open(res.url, "_blank", "noopener,noreferrer");
      }}>{busy ? "Opening…" : "Open"}</Button>
      {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
    </span>
  );
}

export function RemoveFileButton({ fileId, label }: { fileId: string; label: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirm) return <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${label}`} onClick={() => setConfirm(true)}>Remove</Button>;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="inline-flex gap-1">
        <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await removeProjectFile(fileId);
          setBusy(false);
          if (res.error) return setError(res.error);
          router.refresh();
        }}>{busy ? "Removing…" : "Confirm remove"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>Keep</Button>
      </span>
      {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
    </span>
  );
}
