"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { recordEstimateSent } from "@/lib/actions/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { todayInDubai } from "@/components/sales/format";

/**
 * "Record estimate as sent" for ONE finalised revision. It records something the person already did outside the app (this system sends nothing), asks for the
 * date it went out and links the record to this exact revision. It NEVER moves the enquiry's stage ("Estimate sent" is no longer a pipeline stage): the
 * dialog says where the enquiry is and that it stays there.
 */
export function RecordEstimateSentButton({ proposalId, opportunityId, version, label, issueDate, stageLabel }: {
  proposalId: string; opportunityId: string; version: number; label: string; issueDate: string | null; stageLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const today = todayInDubai();
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}><Send className="h-4 w-4" aria-hidden /> Record estimate as sent</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record estimate as sent" description={label}>
        <ActionForm action={recordEstimateSent} submitLabel="Record as sent" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="proposalId" value={proposalId} />
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <input type="hidden" name="version" value={version} />
          <p className="text-sm">Use this after you have sent this estimate to the client yourself (by email, WhatsApp or in person). Enginious OS does not send it. Finalising or downloading an estimate does not record it as sent.</p>
          <Field label="Date it was sent" htmlFor={`est-sent-${proposalId}`} hint="The day it actually went to the client: not in the future, and not before the estimate was finalised.">
            <Input id={`est-sent-${proposalId}`} name="sentOn" type="date" required min={issueDate ?? undefined} max={today} defaultValue={today} />
          </Field>
          <p className="text-sm text-muted-foreground" role="note">The enquiry stays at {stageLabel}. Recording an estimate as sent does not move the enquiry: move the stage yourself when its own evidence is recorded.</p>
          <p className="text-sm text-muted-foreground">The record is linked to this exact revision, with the date it was sent and the time it was recorded, and shown in the enquiry&apos;s history. It is not a sent proposal, not a Zoho Books quote, not an approval and not a win.</p>
        </ActionForm>
      </Modal>
    </>
  );
}
