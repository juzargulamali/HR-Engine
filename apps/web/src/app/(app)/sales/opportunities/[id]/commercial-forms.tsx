"use client";

import { useState } from "react";
import { confirmAvailability, decideApproval, saveZohoReference } from "@/lib/actions/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";

export interface ZohoValues {
  quoteRef: string | null;
  quoteSentOn: string | null;
  invoiceRef: string | null;
  invoiceIssuedOn: string | null;
  paymentReceivedOn: string | null;
  paidAmount: number | null;
}

/** References typed in by hand. Zoho Books stays the accounting record; nothing here is read from or sent to it. */
export function ZohoForm({ opportunityId, values, currency }: { opportunityId: string; values: ZohoValues; currency: string }) {
  return (
    <ActionForm action={saveZohoReference} submitLabel="Save references" className="space-y-4">
      <input type="hidden" name="id" value={opportunityId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quote reference (Zoho Books)" htmlFor="z-qref" hint="Needed before the opportunity can move to Quote sent."><Input id="z-qref" name="quoteRef" defaultValue={values.quoteRef ?? ""} /></Field>
        <Field label="Quote sent on" htmlFor="z-qdate"><Input id="z-qdate" name="quoteSentOn" type="date" defaultValue={values.quoteSentOn ?? ""} /></Field>
        <Field label="Invoice reference (Zoho Books)" htmlFor="z-iref"><Input id="z-iref" name="invoiceRef" defaultValue={values.invoiceRef ?? ""} /></Field>
        <Field label="Invoice issued on" htmlFor="z-idate"><Input id="z-idate" name="invoiceIssuedOn" type="date" defaultValue={values.invoiceIssuedOn ?? ""} /></Field>
        <Field label="Payment received on" htmlFor="z-pdate"><Input id="z-pdate" name="paymentReceivedOn" type="date" defaultValue={values.paymentReceivedOn ?? ""} /></Field>
        <Field label={`Amount paid (${currency})`} htmlFor="z-paid"><Input id="z-paid" name="paidAmount" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={values.paidAmount ?? ""} /></Field>
      </div>
      <p className="text-xs text-muted-foreground">Entered by hand from Zoho Books. A quote sent, an invoice issued and a payment received are three separate facts.</p>
    </ActionForm>
  );
}

/** For people holding confirm_availability. The result is a dated check of the current dates and quantities, nothing more. */
export function ConfirmAvailabilityButton({ opportunityId, recheck }: { opportunityId: string; recheck: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>{recheck ? "Record a new check" : "Record the check"}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record equipment availability" description="You are recording a dated check against the dates and quantities as they are now. It is not a reservation and not a commercial confirmation.">
        <ActionForm action={confirmAvailability} submitLabel="Save the check" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="id" value={opportunityId} />
          <Field label="Result" htmlFor="av-state">
            <Select id="av-state" name="state" defaultValue="confirmed">
              <option value="confirmed">Available for these dates and quantities</option>
              <option value="unavailable">Not available</option>
            </Select>
          </Field>
          <Field label="Note" htmlFor="av-notes" hint="What was checked, or the alternative if it is not available.">
            <Textarea id="av-notes" name="notes" rows={3} required />
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Founders only. "Approved" is recorded under your name; asking for changes needs the instruction. */
export function DecideApprovalButton({ approvalId, opportunityId }: { approvalId: string; opportunityId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"approved" | "changes_requested">("approved");
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>Decide</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Decide the commercial approval" description="Your decision is recorded under your name with the time.">
        <ActionForm action={decideApproval} submitLabel="Record decision" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="approvalId" value={approvalId} />
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <Field label="Decision" htmlFor="ap-state">
            <Select id="ap-state" name="state" value={state} onChange={(e) => setState(e.target.value as "approved" | "changes_requested")}>
              <option value="approved">Approve</option>
              <option value="changes_requested">Ask for changes</option>
            </Select>
          </Field>
          <Field label={state === "changes_requested" ? "What needs to change (required)" : "Comment (optional)"} htmlFor="ap-instruction">
            <Textarea id="ap-instruction" name="instruction" rows={3} required={state === "changes_requested"} />
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}
