"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, UserPlus } from "lucide-react";
import { createAccount, saveAccountProfile } from "@/lib/actions/clients-agencies";
import { createContact, updateContact } from "@/lib/actions/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, ORGANISATION_ROLES, ROLE_LABEL } from "@/lib/crm/clients-agencies/normalise";
import type { CrmContactRow, CrmLeadSource, CrmOrganisationRole } from "@/types/crm";

export interface PersonOption { id: string; name: string }

export interface AccountFormValues {
  name: string;
  roles: readonly CrmOrganisationRole[];
  country: string;
  website: string;
  vatTrn: string;
  tradeLicence: string;
  place: string;
  note: string;
  leadSource: CrmLeadSource | "";
  exhibition: string;
}
const BLANK: AccountFormValues = { name: "", roles: [], country: "", website: "", vatTrn: "", tradeLicence: "", place: "", note: "", leadSource: "", exhibition: "" };

function ProfileFields({ values, withOwner }: { values: AccountFormValues; withOwner?: PersonOption[] | null }) {
  return (
    <>
      <Field label="Name" htmlFor="acc-name"><Input id="acc-name" name="name" required defaultValue={values.name} autoComplete="off" /></Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Role (one company can be several)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ORGANISATION_ROLES.map((r) => (
            <label key={r} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input type="checkbox" name="roles" value={r} defaultChecked={values.roles.includes(r)} className="h-4 w-4" />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Leave all unticked if you do not know yet.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Country (optional)" htmlFor="acc-country" hint="Name or two-letter code, e.g. United Arab Emirates or AE."><Input id="acc-country" name="country" defaultValue={values.country} autoComplete="off" /></Field>
        <Field label="City or place (optional)" htmlFor="acc-place"><Input id="acc-place" name="place" defaultValue={values.place} autoComplete="off" /></Field>
      </div>
      <Field label="Website (optional)" htmlFor="acc-website"><Input id="acc-website" name="website" type="text" inputMode="url" defaultValue={values.website} autoComplete="off" placeholder="example.com" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="VAT registration number / TRN (optional)" htmlFor="acc-vat" hint="Printed on quotations billed to this organisation. Kept exactly as typed, including leading zeros."><Input id="acc-vat" name="vatTrn" defaultValue={values.vatTrn} autoComplete="off" maxLength={40} inputMode="text" /></Field>
        <Field label="Trade licence number (optional)" htmlFor="acc-licence" hint="Kept exactly as typed, including leading zeros."><Input id="acc-licence" name="tradeLicence" defaultValue={values.tradeLicence} autoComplete="off" maxLength={40} inputMode="text" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lead source (optional)" htmlFor="acc-source">
          <Select id="acc-source" name="leadSource" defaultValue={values.leadSource}>
            <option value="">Not recorded</option>
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Exhibition (optional)" htmlFor="acc-exhibition"><Input id="acc-exhibition" name="exhibition" defaultValue={values.exhibition} autoComplete="off" placeholder="Name of the show where we met" /></Field>
      </div>
      <Field label="Relationship notes (optional)" htmlFor="acc-note" hint="How they usually buy, who introduced them, what matters to them.">
        <Textarea id="acc-note" name="note" defaultValue={values.note} rows={3} />
      </Field>
      {withOwner ? (
        <Field label="Account owner (optional)" htmlFor="acc-owner">
          <Select id="acc-owner" name="ownerId" defaultValue="">
            <option value="">Unassigned</option>
            {withOwner.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      ) : null}
    </>
  );
}

/** "Add account": only the name is required. A first contact can be added here; more are added from the account page. */
export function AddAccountButton({ companyId, ownerChoices }: { companyId: string; ownerChoices: PersonOption[] | null }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Add account</Button>
      <Modal open={open} onClose={() => setOpen(false)} size="wide" title="Add account" description="Only the name is needed. Fill in the rest now or later.">
        <ActionForm
          action={createAccount}
          submitLabel="Add account"
          onDone={(s) => { setOpen(false); if (s.id) router.push(`/sales/accounts/${s.id}?company=${companyId}`); }}
          secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
        >
          <input type="hidden" name="companyId" value={companyId} />
          <ProfileFields values={BLANK} withOwner={ownerChoices} />
          <fieldset className="space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">First contact (optional)</legend>
            <Field label="Name" htmlFor="acc-c-name"><Input id="acc-c-name" name="contactName" autoComplete="off" /></Field>
            <Field label="Title" htmlFor="acc-c-role"><Input id="acc-c-role" name="contactRole" autoComplete="off" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email" htmlFor="acc-c-email"><Input id="acc-c-email" name="contactEmail" type="email" autoComplete="off" /></Field>
              <Field label="Phone" htmlFor="acc-c-phone"><Input id="acc-c-phone" name="contactPhone" type="tel" autoComplete="off" /></Field>
            </div>
          </fieldset>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Edit the profile of an existing account (also how an imported, incomplete profile is filled in later). */
export function EditAccountButton({ orgId, companyId, values }: { orgId: string; companyId: string; values: AccountFormValues }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><Pencil className="h-4 w-4" aria-hidden /> Edit profile</Button>
      <Modal open={open} onClose={() => setOpen(false)} size="wide" title="Edit profile" description="Name, roles, country, website and notes are shared across Enginious companies. Lead source and exhibition are for this company only.">
        <ActionForm action={saveAccountProfile} submitLabel="Save profile" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="companyId" value={companyId} />
          <ProfileFields values={values} />
        </ActionForm>
      </Modal>
    </>
  );
}

/** Add another contact to this organisation (an account can have as many as needed). */
export function AddAccountContactButton({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" aria-hidden /> Add contact<span className="sr-only"> to {orgName}</span></Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add contact" description="Only the name is required.">
        <ActionForm action={createContact} submitLabel="Add contact" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="organisationId" value={orgId} />
          <ContactFields />
        </ActionForm>
      </Modal>
    </>
  );
}

function ContactFields({ contact }: { contact?: CrmContactRow }) {
  return (
    <>
      <Field label="Name" htmlFor="ct-name"><Input id="ct-name" name="name" required defaultValue={contact?.name ?? ""} autoComplete="off" /></Field>
      <Field label="Title (optional)" htmlFor="ct-role"><Input id="ct-role" name="roleTitle" defaultValue={contact?.role_title ?? ""} autoComplete="off" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email (optional)" htmlFor="ct-email"><Input id="ct-email" name="email" type="email" defaultValue={contact?.email ?? ""} autoComplete="off" /></Field>
        <Field label="Phone (optional)" htmlFor="ct-phone"><Input id="ct-phone" name="phone" type="tel" defaultValue={contact?.phone ?? ""} autoComplete="off" /></Field>
      </div>
    </>
  );
}

/** Edit a contact's details. Contacts are shared records; the database decides who may change one and says so in words. */
export function EditAccountContactButton({ contact }: { contact: CrmContactRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>Edit<span className="sr-only"> {contact.name}</span></Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit contact" description="This person is a shared record: the change shows everywhere they appear.">
        <ActionForm action={updateContact} submitLabel="Save contact" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="contactId" value={contact.id} />
          <ContactFields contact={contact} />
        </ActionForm>
      </Modal>
    </>
  );
}
