"use client";

import { issueClientTimeline, recordTimelineAccepted, recordTimelineSent } from "@/lib/actions/projectsPlans";
import { Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogForm } from "../changes/dialog-form";

export function IssueTimelineForm({ projectId, reference, hasIssued }: { projectId: string; reference: string; hasIssued: boolean }) {
  return (
    <DialogForm
      triggerLabel={hasIssued ? "Issue a new version" : "Issue this timeline"} triggerVariant="default" title="Issue the client timeline"
      description="This freezes what is shown in the preview as a numbered version. It does not send anything to the client. Issuing the same content again returns the version that already exists."
      action={issueClientTimeline} submitLabel="Issue version"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <Field label="Reference shown to the client (optional)" htmlFor="it-ref" hint={`Left empty it uses the project reference, ${reference}. Use a reference that is safe to show the client; never a price or PO number.`}>
        <Input id="it-ref" name="clientReference" maxLength={100} />
      </Field>
      <Field label="Note for the record (optional)" htmlFor="it-note" hint="Kept with the version; not printed on the PDF."><Textarea id="it-note" name="note" rows={2} /></Field>
    </DialogForm>
  );
}

export function RecordSentForm({ projectId, planId, version }: { projectId: string; planId: string; version: number }) {
  return (
    <DialogForm triggerLabel="Record as sent" title={`Record that version ${version} was sent`} description="This only records a fact you did outside the app. The app sends nothing." action={recordTimelineSent} submitLabel="Record">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="planId" value={planId} />
      <Field label="How and to whom it was sent" htmlFor={`rs-${planId}`}><Textarea id={`rs-${planId}`} name="note" rows={3} required placeholder="e.g. E-mailed as a PDF to Sara at Orbit Motors on 12 Mar" /></Field>
    </DialogForm>
  );
}

export function RecordAcceptedForm({ projectId, planId, version, today }: { projectId: string; planId: string; version: number; today: string }) {
  return (
    <DialogForm triggerLabel="Record client acceptance" title={`Record that the client accepted version ${version}`} description="Acceptance is a fact someone at the client told you. It is recorded separately from issuing and from sending." action={recordTimelineAccepted} submitLabel="Record acceptance">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="planId" value={planId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Accepted on" htmlFor={`ra-d-${planId}`}><Input id={`ra-d-${planId}`} name="acceptedOn" type="date" required max={today} defaultValue={today} /></Field>
        <Field label="Who at the client accepted" htmlFor={`ra-c-${planId}`}><Input id={`ra-c-${planId}`} name="contact" required placeholder="Name and company" /></Field>
      </div>
      <Field label="Note (optional)" htmlFor={`ra-n-${planId}`}><Textarea id={`ra-n-${planId}`} name="note" rows={2} placeholder="e.g. By e-mail, subject “Re: Timeline v2”" /></Field>
    </DialogForm>
  );
}
