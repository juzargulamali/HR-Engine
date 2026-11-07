"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { assignAccountOwner, createAccountFollowUp, reassignFollowUp } from "@/lib/actions/clients-agencies";
import { createFollowUp } from "@/lib/actions/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { todayInDubai } from "@/components/sales/format";
import type { PersonOption } from "./account-forms";

/** Change the ACCOUNT owner for the selected company. Shown only to people who hold the assign-owners right; the database checks it again. */
export function AssignOwnerButton({ orgId, companyId, ownerId, people }: { orgId: string; companyId: string; ownerId: string | null; people: PersonOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>{ownerId ? "Change owner" : "Assign owner"}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Account owner" description="Who owns this account for this company. This does not change who is following up, or who owns any inquiry.">
        <ActionForm action={assignAccountOwner} submitLabel="Save owner" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="companyId" value={companyId} />
          <Field label="Account owner" htmlFor="owner-pick" hint="Only people with Sales access for this company are listed.">
            <Select id="owner-pick" name="ownerId" defaultValue={ownerId ?? ""}>
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Hand one open follow-up to someone else. Changes only the follow-up. */
export function ReassignFollowUpButton({ followUpId, assigneeId, people, title }: { followUpId: string; assigneeId: string; people: PersonOption[]; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>Reassign<span className="sr-only"> follow-up: {title}</span></Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Reassign follow-up" description="Who is following this up. The account owner and the inquiry owner stay as they are.">
        <ActionForm action={reassignFollowUp} submitLabel="Save" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="followUpId" value={followUpId} />
          <Field label="Follow-up for" htmlFor={`fu-who-${followUpId}`}>
            <Select id={`fu-who-${followUpId}`} name="assigneeId" defaultValue={assigneeId}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/** A dated follow-up on one of this account's open inquiries, with its own assignee (follow-ups belong to an inquiry). */
export function AddFollowUpButton({ inquiries, people, defaultAssigneeId }: { inquiries: { id: string; label: string }[]; people: PersonOption[]; defaultAssigneeId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><CalendarPlus className="h-4 w-4" aria-hidden /> Add follow-up</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add follow-up" description="A dated task on one of this account's open inquiries, for whoever should do it.">
        <ActionForm action={createFollowUp} submitLabel="Add follow-up" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <Field label="Inquiry" htmlFor="fu-opp"><Select id="fu-opp" name="id" defaultValue={inquiries[0]?.id}>{inquiries.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
          <Field label="What to do" htmlFor="fu-title"><Input id="fu-title" name="title" required autoComplete="off" placeholder="e.g. Follow up the exhibition introduction" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Due date" htmlFor="fu-date"><Input id="fu-date" name="date" type="date" required defaultValue={todayInDubai()} /></Field>
            <Field label="Time (Dubai)" htmlFor="fu-time"><Input id="fu-time" name="time" type="time" defaultValue="09:00" /></Field>
          </div>
          <Field label="Follow-up for" htmlFor="fu-assignee"><Select id="fu-assignee" name="assignedTo" defaultValue={defaultAssigneeId}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/**
 * A dated follow-up on this account when it has no inquiry to hang one on. The person chosen must have Sales access for this company (the list holds only
 * them) and only someone with the assign owners right may choose anyone but themselves (`canAssign`; the database checks it again). The account owner is untouched.
 */
export function AddAccountFollowUpButton({ orgId, companyId, people, currentUserId, canAssign }: { orgId: string; companyId: string; people: PersonOption[]; currentUserId: string; canAssign: boolean }) {
  const [open, setOpen] = useState(false);
  const choices = canAssign ? people : people.filter((p) => p.id === currentUserId);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><CalendarPlus className="h-4 w-4" aria-hidden /> Add follow-up</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add follow-up" description="A dated task on this account, which has no inquiry yet. It does not change the account owner.">
        <ActionForm action={createAccountFollowUp} submitLabel="Add follow-up" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="companyId" value={companyId} />
          <Field label="What to do" htmlFor="afu-title"><Input id="afu-title" name="title" required autoComplete="off" placeholder="e.g. Send our portfolio and ask for a meeting" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Due date" htmlFor="afu-date"><Input id="afu-date" name="date" type="date" required defaultValue={todayInDubai()} /></Field>
            <Field label="Time (Dubai)" htmlFor="afu-time"><Input id="afu-time" name="time" type="time" defaultValue="09:00" /></Field>
          </div>
          <Field label="Follow-up for" htmlFor="afu-assignee" hint={canAssign ? "Only people with Sales access for this company are listed." : "Only a founder, or someone they delegated, can give a follow-up to someone else."}>
            <Select id="afu-assignee" name="assignedTo" defaultValue={currentUserId}>{choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}
