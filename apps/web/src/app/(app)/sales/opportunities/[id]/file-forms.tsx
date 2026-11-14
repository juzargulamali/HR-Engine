"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addLink } from "@/lib/actions/crm";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ActionForm, Field } from "@/components/sales/action-form";
import { FILE_PURPOSES } from "./helpers";
import { CRM_FILE_ACCEPT, FILE_RULES_HELP, useCrmUpload } from "./use-crm-upload";

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
          <Field label="Link" htmlFor="ln-url" hint="Must start with https://." help="A link is only as private as its own sharing settings, which you control, not this system.">
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

function UploadFileForm({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const { busy, phaseText, upload } = useCrmUpload(opportunityId);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    setError(null);
    setDone(null);
    const result = await upload(file instanceof File ? file : null, String(data.get("purpose") ?? "other"), String(data.get("label") ?? ""));
    if (result.error !== null) return setError(result.error);
    setDone(`${file instanceof File ? file.name : "The file"} was added.`);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="File" htmlFor="up-file" help={FILE_RULES_HELP}>
        <Input id="up-file" name="file" type="file" required accept={CRM_FILE_ACCEPT} disabled={busy} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What is it" htmlFor="up-purpose" help="Choose what it is so the history can tell a proposal from a purchase order.">
          <Select id="up-purpose" name="purpose" defaultValue="other" disabled={busy}>{FILE_PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
        </Field>
        <Field label="Label (optional)" htmlFor="up-label"><Input id="up-label" name="label" placeholder="e.g. Proposal v2, signed PO" disabled={busy} /></Field>
      </div>
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      {done ? <Alert role="status">{done}</Alert> : null}
      <div className="flex items-center justify-end gap-3">
        {busy ? <span role="status" className="text-sm text-muted-foreground">{phaseText}</span> : null}
        <Button type="submit" disabled={busy}>{busy ? "Working…" : "Upload file"}</Button>
      </div>
    </form>
  );
}
