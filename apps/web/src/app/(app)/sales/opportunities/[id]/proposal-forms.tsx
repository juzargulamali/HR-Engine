"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addProposal, setProposalStatus } from "@/lib/actions/crm";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { todayInDubai } from "@/components/sales/format";
import { useUnsavedChanges } from "@/components/workspace/unsaved";
import { cn } from "@/lib/utils";
import { CRM_FILE_ACCEPT, FILE_RULES_HELP, useCrmUpload } from "./use-crm-upload";

export interface FileOption { id: string; label: string }

type Source = "upload" | "existing" | "none";

/**
 * Adds the next version as a draft, with its document in the same step: upload a new file, use one already on the enquiry, or add the version without one.
 * The upload is the same private, checked upload as under Files (use-crm-upload.ts), so the file also appears there. The version number is assigned by the
 * database. Two things are written, one after the other: the file, then the version. If the file went up and the version did not, the file is kept and the
 * next attempt reuses it (nothing is uploaded twice); it is also listed under "a file already added" from then on.
 */
export function AddProposalForm({ opportunityId, nextVersion, files }: { opportunityId: string; nextVersion: number; files: FileOption[] }) {
  const router = useRouter();
  const { busy: uploading, phaseText, upload } = useCrmUpload(opportunityId);
  const [source, setSource] = useState<Source>("upload");
  const [uploaded, setUploaded] = useState<{ id: string; name: string } | null>(null);
  const [existingId, setExistingId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The file is up and the version is not: said in words, with Retry. */
  const [versionPending, setVersionPending] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = uploading || adding;
  useUnsavedChanges(useId(), note.trim() !== "" || !!uploaded);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setSaved(null);
    let fileId = "";
    if (source === "existing") {
      if (!existingId) return setError("Choose one of the files already added, or choose another way to add the document.");
      fileId = existingId;
    } else if (source === "upload") {
      if (uploaded) fileId = uploaded.id; // already uploaded by an earlier attempt: reused, never uploaded again
      else {
        const file = fileRef.current?.files?.[0] ?? null;
        const result = await upload(file, "proposal");
        if (result.error !== null) return setError(result.error);
        router.refresh();
        if (!result.fileId) {
          // The file is on the enquiry, but the server did not say which one it is: it can be chosen from the list instead.
          setSource("existing");
          return setError("The file was uploaded and is listed under Files and links. Choose it under “Use a file already added”, then add the version.");
        }
        setUploaded({ id: result.fileId, name: file?.name ?? "the uploaded file" });
        fileId = result.fileId;
      }
    }
    setAdding(true);
    try {
      const data = new FormData();
      data.set("id", opportunityId);
      data.set("note", note);
      if (fileId) data.set("fileId", fileId);
      const result = await addProposal({ error: null }, data);
      if (result.error) {
        setVersionPending(source === "upload");
        return setError(result.error);
      }
      setSaved(`Version ${nextVersion} was added as a draft.`);
      setNote("");
      setUploaded(null);
      setExistingId("");
      setVersionPending(false);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch {
      setVersionPending(source === "upload");
      setError("The version could not be saved. Check your connection and try again.");
    } finally {
      setAdding(false);
    }
  }

  const choices: [Source, string][] = [["upload", "Upload a new file"], ["existing", "Use a file already added"], ["none", "No document yet"]];
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="What changed" htmlFor="pv-note">
        <Textarea id="pv-note" name="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="e.g. Added the second LED wall after the client call." />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Proposal document</legend>
        <div className="flex flex-wrap gap-2">
          {choices.map(([v, l]) => (
            <label key={v} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium", source === v ? "border-accent bg-accent/10" : "border-border")}>
              <input type="radio" name="pv-source" checked={source === v} disabled={busy} onChange={() => { setSource(v); setError(null); setVersionPending(false); }} />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      {source === "upload" ? (
        uploaded ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm" data-testid="pv-uploaded">
            <span className="min-w-0 break-words"><span className="font-medium">Uploaded:</span> {uploaded.name}. It will be attached to version {nextVersion}.</span>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setUploaded(null); setVersionPending(false); setError(null); }}>Use a different file</Button>
          </div>
        ) : (
          <Field label="File" htmlFor="pv-upload" help={FILE_RULES_HELP}>
            <Input ref={fileRef} id="pv-upload" name="file" type="file" accept={CRM_FILE_ACCEPT} disabled={busy} />
          </Field>
        )
      ) : null}
      {source === "existing" ? (
        <Field label="File or link already added" htmlFor="pv-file" hint={files.length === 0 ? "No file or link on this enquiry is free to use. Upload a new file instead." : undefined} help="Files and links under Files and links that are not already attached to another version.">
          <Select id="pv-file" name="fileId" value={existingId} onChange={(e) => setExistingId(e.target.value)} disabled={busy || files.length === 0}>
            <option value="">Choose a file or link…</option>
            {files.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
        </Field>
      ) : null}
      {versionPending && uploaded ? (
        <Alert variant="warning" role="alert">
          <p className="font-medium">The file was uploaded. Adding the version did not finish.</p>
          <p className="mt-1">Retry adds the version with the same file: it is not uploaded again. The file is also listed under Files and links.</p>
        </Alert>
      ) : null}
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      {saved ? <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--os-green))]"><span className="os-dot" data-tone="green" aria-hidden />{saved}</p> : null}
      <p className="text-sm text-muted-foreground">Records a draft version. Nothing is sent to the client from here.</p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {uploading ? <span role="status" className="text-sm text-muted-foreground">{phaseText}</span> : null}
        <Button type="submit" disabled={busy}>{uploading ? "Uploading…" : adding ? "Adding…" : versionPending && uploaded ? `Retry adding version ${nextVersion}` : `Add version ${nextVersion} as a draft`}</Button>
      </div>
    </form>
  );
}

const COPY = {
  sent: { button: "Record as sent", title: "Record this version as sent", submit: "Record as sent" },
  accepted: { button: "Record as accepted", title: "Record this version as accepted", submit: "Record as accepted" },
  superseded: { button: "Mark superseded", title: "Mark this version as superseded", submit: "Mark superseded" },
} as const;

/** One status change for one proposal. "Sent" needs the real date it went out; "accepted" is explicit that it is not the win. */
export function ProposalStatusButton({ proposalId, opportunityId, version, status }: { proposalId: string; opportunityId: string; version: number; status: "sent" | "accepted" | "superseded" }) {
  const [open, setOpen] = useState(false);
  const c = COPY[status];
  return (
    <>
      <Button type="button" size="sm" variant={status === "superseded" ? "ghost" : "outline"} onClick={() => setOpen(true)}>{c.button}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={c.title} description={`Version ${version}`}>
        <ActionForm action={setProposalStatus} submitLabel={c.submit} onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="proposalId" value={proposalId} />
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <input type="hidden" name="status" value={status} />
          {status === "sent" ? (
            <>
              <Field label="Date it was sent" htmlFor={`sent-${proposalId}`} hint="The day it actually went to the client, not in the future. Any earlier version recorded as sent becomes superseded.">
                <Input id={`sent-${proposalId}`} name="sentOn" type="date" required max={todayInDubai()} defaultValue={todayInDubai()} />
              </Field>
              <p className="text-sm text-muted-foreground">Recording it as sent is a fact about what you did. It is not an approval and not a win. This system does not send anything.</p>
            </>
          ) : null}
          {status === "accepted" ? <p className="text-sm">Use this when the client has said they accept this version. It does not make the opportunity Won: winning needs a purchase order or an authorised email.</p> : null}
          {status === "superseded" ? <p className="text-sm">Use this when a newer version replaces this one. It stays in the list as history.</p> : null}
        </ActionForm>
      </Modal>
    </>
  );
}
