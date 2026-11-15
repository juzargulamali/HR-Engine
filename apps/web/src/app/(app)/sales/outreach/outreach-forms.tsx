"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardPen, Link2, Plus } from "lucide-react";
import { linkOutreachInquiry, logOutreachActivity, setOutreachContact, setOutreachNextAction, setOutreachStatus } from "@/lib/actions/outreach";
import { OUTREACH_KIND_LABEL, OUTREACH_KINDS, OUTREACH_OUTCOME_LABEL, OUTREACH_SETTABLE_STATUSES, OUTREACH_STATUS_LABEL, outcomeAfterKindChange, outcomesForKind } from "@/lib/crm/clients-agencies/outreach";
import type { CrmOutreachStatus } from "@/types/crm";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { todayInDubai } from "@/components/sales/format";

/** The salesperson's controls on one outreach (account page, section Outreach). The database checks who may act on every one of them again. */

/** What / Date / Outcome. The outcome choices follow the chosen kind, and changing the kind clears an outcome that does not fit the new one. */
export function KindOutcomeFields({ id }: { id: string }) {
  const [kind, setKind] = useState<string>("call");
  const [outcome, setOutcome] = useState("");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What" htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} name="kind" required value={kind} onChange={(e) => { setKind(e.target.value); setOutcome(outcomeAfterKindChange(e.target.value, outcome)); }}>
            {OUTREACH_KINDS.map((k) => <option key={k} value={k}>{OUTREACH_KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Date it happened" htmlFor={`${id}-on`}><Input id={`${id}-on`} name="on" type="date" required max={todayInDubai()} defaultValue={todayInDubai()} /></Field>
      </div>
      <Field label="Outcome" htmlFor={`${id}-outcome`}>
        <Select id={`${id}-outcome`} name="outcome" required value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="" disabled>Choose an outcome…</option>
          {outcomesForKind(kind).map((o) => <option key={o} value={o}>{OUTREACH_OUTCOME_LABEL[o]}</option>)}
        </Select>
      </Field>
    </>
  );
}

export function LogActivityButton({ outreachId, accountName }: { outreachId: string; accountName: string }) {
  const [open, setOpen] = useState(false);
  const id = `lg-${outreachId}`;
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Log activity<span className="sr-only"> with {accountName}</span></Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Log activity" description={`A call, email or meeting with ${accountName}. It records what you did: nothing is sent to the client from here.`} help="The entry is kept in the history and cannot be edited. Choosing an outcome is how you record a reply: nothing is assumed.">
        <ActionForm action={logOutreachActivity} submitLabel="Log activity" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="outreachId" value={outreachId} />
          <KindOutcomeFields id={id} />
          <Field label="Note (optional)" htmlFor={`${id}-note`}><Textarea id={`${id}-note`} name="note" rows={2} maxLength={1000} /></Field>
          <fieldset className="space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">Next action (optional here)</legend>
            <Field label="What to do next" htmlFor={`${id}-next`}><Input id={`${id}-next`} name="nextAction" maxLength={300} autoComplete="off" placeholder="e.g. Send the portfolio" /></Field>
            <Field label="Due date" htmlFor={`${id}-due`}><Input id={`${id}-due`} name="nextDue" type="date" /></Field>
          </fieldset>
        </ActionForm>
      </Modal>
    </>
  );
}

export function NextActionButton({ outreachId, current, due, accountName, primary = false }: { outreachId: string; current: string | null; due: string | null; /** Named for screen readers where several rows carry the button. */ accountName?: string; /** The row's one action (the Outreach list) rather than one of several (the account page). */ primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = `na-${outreachId}`;
  return (
    <>
      <Button type="button" variant={primary ? "default" : "outline"} size="sm" onClick={() => setOpen(true)}><ClipboardPen className="h-4 w-4" aria-hidden /> {current ? "Change next action" : "Set next action"}{accountName ? <span className="sr-only"> for {accountName}</span> : null}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Next action" description="What happens next and by when. It shows in My outreach and in the Sales lead view.">
        <ActionForm action={setOutreachNextAction} submitLabel="Save next action" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="outreachId" value={outreachId} />
          <Field label="What to do next" htmlFor={`${id}-t`}><Input id={`${id}-t`} name="nextAction" required maxLength={300} autoComplete="off" defaultValue={current ?? ""} /></Field>
          <Field label="Due date" htmlFor={`${id}-d`}><Input id={`${id}-d`} name="nextDue" type="date" required defaultValue={due ?? todayInDubai()} /></Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Explicit status control. Enquiry raised is not offered: it is set only by linking an enquiry. Closed asks for a short reason. */
export function StatusControl({ outreachId, status }: { outreachId: string; status: CrmOutreachStatus }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(status === "inquiry_raised" ? "closed" : status);
  const id = `st-${outreachId}`;
  const choices = status === "inquiry_raised" ? (["closed"] as const) : OUTREACH_SETTABLE_STATUSES;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Status: {OUTREACH_STATUS_LABEL[status]}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Progress status" description="Set by you, never guessed from what you log. Logging the first activity moves Not started to In progress; linking an enquiry sets Enquiry raised.">
        <ActionForm action={setOutreachStatus} submitLabel="Save status" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="outreachId" value={outreachId} />
          <Field label="Status" htmlFor={`${id}-s`}>
            <Select id={`${id}-s`} name="status" value={choice} onChange={(e) => setChoice(e.target.value)}>{choices.map((s) => <option key={s} value={s}>{OUTREACH_STATUS_LABEL[s]}</option>)}</Select>
          </Field>
          {choice === "closed" ? <Field label="Why is it closed?" htmlFor={`${id}-r`} hint="Required. For example “Not interested” or “No longer relevant”."><Input id={`${id}-r`} name="reason" required maxLength={500} autoComplete="off" /></Field> : null}
        </ActionForm>
      </Modal>
    </>
  );
}

/**
 * The contact this outreach is with: one of the account's own contacts. It is what "Create enquiry" carries into the New enquiry form, so nobody retypes or guesses
 * who the enquiry is from. Read-only once the outreach is closed or has raised its enquiry.
 */
export function OutreachContactControl({ outreachId, contactId, contacts, readOnly = false }: {
  outreachId: string; contactId: string | null; contacts: readonly { id: string; name: string; roleTitle: string | null }[]; readOnly?: boolean;
}) {
  const id = `oc-${outreachId}`;
  const current = contacts.find((c) => c.id === contactId) ?? null;
  const label = (c: { name: string; roleTitle: string | null }) => (c.roleTitle ? `${c.name} · ${c.roleTitle}` : c.name);
  if (readOnly) {
    return <p className="text-sm" data-testid="outreach-contact"><span className="text-muted-foreground">Contact: </span>{current ? label(current) : contactId ? "A contact no longer on this account" : "None chosen"}</p>;
  }
  if (contacts.length === 0) {
    return <p className="text-sm" data-testid="outreach-contact"><span className="text-muted-foreground">Contact: </span>This account has no contacts yet. Use Add contact at the top of the page, then choose who this outreach is with.</p>;
  }
  return (
    <div data-testid="outreach-contact">
      <ActionForm action={setOutreachContact} submitLabel="Save contact" pendingLabel="Saving…">
        <input type="hidden" name="outreachId" value={outreachId} />
        <Field label="Contact for this outreach" htmlFor={`${id}-c`} hint="Who you are speaking to. Create enquiry carries this person into the new enquiry.">
          <Select id={`${id}-c`} name="contactId" defaultValue={current ? current.id : ""} key={contactId ?? "none"}>
            <option value="">No contact chosen</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}
          </Select>
        </Field>
      </ActionForm>
    </div>
  );
}

/**
 * Raise a real inquiry: create one through the normal enquiry form or link one the account already has. `createHref` opens the New enquiry form with what the
 * outreach already knows (lib/crm/clients-agencies/outreach-enquiry.ts); the form is the review step and nothing exists until it is saved there.
 */
export function InquiryLinkControls({ outreachId, createHref, inquiries }: { outreachId: string; createHref: string; inquiries: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const id = `lk-${outreachId}`;
  return (
    <>
      <Link href={createHref} className={buttonVariants({ variant: "outline", size: "sm" })} title="Opens the New enquiry form with the account, the company, the contact, the Outreach source and the outreach notes filled in. Nothing is created until you save it there.">Create enquiry</Link>
      {inquiries.length > 0 ? <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><Link2 className="h-4 w-4" aria-hidden /> Link an enquiry</Button> : null}
      <Modal open={open} onClose={() => setOpen(false)} title="Link an enquiry" description="Link an enquiry this account already has. The outreach becomes Enquiry raised; its history stays on the account. No enquiry or deal is created.">
        <ActionForm action={linkOutreachInquiry} submitLabel="Link enquiry" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="outreachId" value={outreachId} />
          <Field label="Enquiry" htmlFor={`${id}-o`}>
            <Select id={`${id}-o`} name="opportunityId" required defaultValue="">
              <option value="" disabled>Choose an enquiry…</option>
              {inquiries.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </Select>
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}
