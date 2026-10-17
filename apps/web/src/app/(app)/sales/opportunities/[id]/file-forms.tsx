"use client";

import { useState } from "react";
import { CRM_ALLOWED_FILE_SUMMARY } from "@enginious-hr/domain";
import { addLink } from "@/lib/actions/crm";
import { uploadCrmFile } from "@/lib/actions/crmFiles";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ActionForm, Field } from "@/components/sales/action-form";
import { FILE_PURPOSES } from "./helpers";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,.txt,.csv";

/** Upload a file or add a link. Uploads go to the server action as FormData (id, file, purpose, label); the browser never talks to storage. */
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
        <ActionForm action={uploadCrmFile} submitLabel="Upload file" pendingLabel="Uploading…" resetOnSuccess>
          <input type="hidden" name="id" value={opportunityId} />
          <Field label="File" htmlFor="up-file" hint={`${CRM_ALLOWED_FILE_SUMMARY}; executables and macro-enabled files are refused.`}>
            <Input id="up-file" name="file" type="file" required accept={ACCEPT} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What is it" htmlFor="up-purpose">
              <Select id="up-purpose" name="purpose" defaultValue="other">{FILE_PURPOSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
            </Field>
            <Field label="Label (optional)" htmlFor="up-label"><Input id="up-label" name="label" placeholder="e.g. Proposal v2, signed PO" /></Field>
          </div>
        </ActionForm>
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
