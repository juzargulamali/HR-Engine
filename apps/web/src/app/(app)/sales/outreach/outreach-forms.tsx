"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardPen, Link2, Plus } from "lucide-react";
import { linkOutreachInquiry, logOutreachActivity, setOutreachNextAction, setOutreachStatus } from "@/lib/actions/outreach";
import { OUTREACH_KIND_LABEL, OUTREACH_KINDS, OUTREACH_OUTCOME_LABEL, OUTREACH_OUTCOMES, OUTREACH_SETTABLE_STATUSES, OUTREACH_STATUS_LABEL } from "@/lib/crm/clients-agencies/outreach";
import type { CrmOutreachStatus } from "@/types/crm";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { todayInDubai } from "@/components/sales/format";

/** The salesperson's controls on one outreach (account page, section Outreach). The database checks who may act on every one of them again. */

export function LogActivityButton({ outreachId, accountName }: { outreachId: string; accountName: string }) {
  const [open, setOpen] = useState(false);
  const id = `lg-${outreachId}`;
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Log activity</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Log activity" description={`A call, email or meeting with ${accountName}. The entry is kept in the history and cannot be edited. Choosing an outcome is how you record a reply: nothing is assumed.`}>
        <ActionForm action={logOutreachActivity} submitLabel="Log activity" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="outreachId" value={outreachId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What" htmlFor={`${id}-kind`}>
              <Select id={`${id}-kind`} name="kind" required defaultValue="call">{OUTREACH_KINDS.map((k) => <option key={k} value={k}>{OUTREACH_KIND_LABEL[k]}</option>)}</Select>
            </Field>
            <Field label="Date it happened" htmlFor={`${id}-on`}><Input id={`${id}-on`} name="on" type="date" required max={todayInDubai()} defaultValue={todayInDubai()} /></Field>
          </div>
          <Field label="Outcome" htmlFor={`${id}-outcome`}>
            <Select id={`${id}-outcome`} name="outcome" required defaultValue="">
              <option value="" disabled>Choose an outcome…</option>
              {OUTREACH_OUTCOMES.map((o) => <option key={o} value={o}>{OUTREACH_OUTCOME_LABEL[o]}</option>)}
            </Select>
          </Field>
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

export function NextActionButton({ outreachId, current, due }: { outreachId: string; current: string | null; due: string | null }) {
  const [open, setOpen] = useState(false);
  const id = `na-${outreachId}`;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><ClipboardPen className="h-4 w-4" aria-hidden /> {current ? "Change next action" : "Set next action"}</Button>
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

/** Explicit status control. Inquiry raised is not offered: it is set only by linking an inquiry. Closed asks for a short reason. */
export function StatusControl({ outreachId, status }: { outreachId: string; status: CrmOutreachStatus }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(status === "inquiry_raised" ? "closed" : status);
  const id = `st-${outreachId}`;
  const choices = status === "inquiry_raised" ? (["closed"] as const) : OUTREACH_SETTABLE_STATUSES;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Status: {OUTREACH_STATUS_LABEL[status]}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Progress status" description="Set by you, never guessed from what you log. Logging the first activity moves Not started to In progress; linking an inquiry sets Inquiry raised.">
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

/** Raise a real inquiry: create one through the normal enquiry form (account and company pre-filled) or link one the account already has. */
export function InquiryLinkControls({ outreachId, orgId, companyId, inquiries }: { outreachId: string; orgId: string; companyId: string; inquiries: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const id = `lk-${outreachId}`;
  return (
    <>
      <Link href={`/sales/new?company=${companyId}&org=${orgId}&outreach=${outreachId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Create inquiry</Link>
      {inquiries.length > 0 ? <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><Link2 className="h-4 w-4" aria-hidden /> Link an inquiry</Button> : null}
      <Modal open={open} onClose={() => setOpen(false)} title="Link an inquiry" description="Link an inquiry this account already has. The outreach becomes Inquiry raised; its history stays on the account. No inquiry or deal is created.">
        <ActionForm action={linkOutreachInquiry} submitLabel="Link inquiry" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="outreachId" value={outreachId} />
          <Field label="Inquiry" htmlFor={`${id}-o`}>
            <Select id={`${id}-o`} name="opportunityId" required defaultValue="">
              <option value="" disabled>Choose an inquiry…</option>
              {inquiries.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </Select>
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}
