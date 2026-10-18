"use client";

import { useState } from "react";
import { addProposal, setProposalStatus } from "@/lib/actions/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { todayInDubai } from "@/components/sales/format";

export interface FileOption { id: string; label: string }

/** Adds the next version as a draft. The version number is assigned by the database. A proposal document is chosen from the Files already added. */
export function AddProposalForm({ opportunityId, nextVersion, files }: { opportunityId: string; nextVersion: number; files: FileOption[] }) {
  return (
    <ActionForm action={addProposal} submitLabel={`Add version ${nextVersion} as a draft`} resetOnSuccess>
      <input type="hidden" name="id" value={opportunityId} />
      <Field label="What changed" htmlFor="pv-note"><Textarea id="pv-note" name="note" rows={2} placeholder="e.g. Added the second LED wall after the client call." /></Field>
      <Field label="Proposal document" htmlFor="pv-file" hint={files.length === 0 ? "None yet. Upload the document or add its link under Files below first, then add the version and choose it here." : "Choose a file or link already added under Files. Add it there first if it is not listed."}>
        <Select id="pv-file" name="fileId" defaultValue="" disabled={files.length === 0}>
          <option value="">No document linked</option>
          {files.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </Select>
      </Field>
    </ActionForm>
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
