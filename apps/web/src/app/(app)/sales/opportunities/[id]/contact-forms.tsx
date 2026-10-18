"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { createAndLinkContact, linkContact, unlinkContact, updateContact } from "@/lib/actions/crm";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { filterPickerContacts, pickerOptionLabel, type ContactPickerData } from "./contact-helpers";

const KIND_LABEL = { agency: "agency", client: "end client", direct: "direct client" } as const;

/**
 * Contacts are SHARED records: adding or removing one on this opportunity only touches the link, while editing details
 * changes the person everywhere. The database enforces who may do what; these dialogs only decide what is offered.
 */

// ---------------------------------------------------------------------------------------------------------------
// Add a contact (existing person, or a new one)
// ---------------------------------------------------------------------------------------------------------------

export function AddContactButton({ opportunityId, picker }: { opportunityId: string; picker: ContactPickerData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>Add a contact</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a contact" description="Put a person on this opportunity. People are shared records: the same person can be on many opportunities.">
        <AddContactBody opportunityId={opportunityId} picker={picker} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function AddContactBody({ opportunityId, picker, onDone }: { opportunityId: string; picker: ContactPickerData; onDone: () => void }) {
  const id = useId();
  const [mode, setMode] = useState<"existing" | "new">(picker.contacts.length > 0 ? "existing" : "new");
  const cancel = <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>;
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who do you want to add?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([["existing", "Someone already in Sales"], ["new", "A new person"]] as const).map(([value, label]) => (
            <label key={value} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input type="radio" name={`${id}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} className="h-4 w-4" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {mode === "existing" ? (
        <ExistingContactForm opportunityId={opportunityId} contacts={picker.contacts} onDone={onDone} cancel={cancel} onNew={() => setMode("new")} />
      ) : (
        <NewContactForm opportunityId={opportunityId} picker={picker} onDone={onDone} cancel={cancel} />
      )}
    </div>
  );
}

function ExistingContactForm({ opportunityId, contacts, onDone, cancel, onNew }: { opportunityId: string; contacts: ContactPickerData["contacts"]; onDone: () => void; cancel: React.ReactNode; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const matches = useMemo(() => filterPickerContacts(contacts, query), [contacts, query]);
  const selected = matches.find((c) => c.id === picked) ?? null;
  if (contacts.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Everyone already in Sales is on this opportunity, or nobody has been added yet.</p>
        <div className="flex flex-wrap justify-end gap-2">{cancel}<Button type="button" onClick={onNew}>Add a new person</Button></div>
      </div>
    );
  }
  return (
    <ActionForm action={linkContact} submitLabel="Add to this opportunity" pendingLabel="Adding…" onDone={onDone} secondary={cancel}>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <Field label="Search by name, organisation, job title or email" htmlFor="add-contact-search">
        <Input id="add-contact-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Person" htmlFor="add-contact-pick" hint="Those already on this opportunity are not listed.">
        <Select id="add-contact-pick" name="contactId" size={6} required value={selected ? selected.id : ""} onChange={(e) => setPicked(e.target.value)} className="h-auto" aria-describedby="add-contact-count">
          {matches.map((c) => <option key={c.id} value={c.id}>{pickerOptionLabel(c)}</option>)}
        </Select>
      </Field>
      <p id="add-contact-count" role="status" className="text-sm text-muted-foreground">
        {matches.length === 0 ? "Nobody matches that search. Try fewer words, or add a new person." : `${matches.length} ${matches.length === 1 ? "person" : "people"} shown.`}
        {selected ? ` Selected: ${selected.name}${selected.organisationName ? `, ${selected.organisationName}` : ""}${selected.email ? `, ${selected.email}` : ""}.` : ""}
      </p>
      <Field label="Role on this opportunity (optional)" htmlFor="add-contact-role" hint="For example Decision maker, Producer, Accounts. It is about this opportunity only.">
        <Input id="add-contact-role" name="role" maxLength={120} />
      </Field>
    </ActionForm>
  );
}

function NewContactForm({ opportunityId, picker, onDone, cancel }: { opportunityId: string; picker: ContactPickerData; onDone: () => void; cancel: React.ReactNode }) {
  return (
    <ActionForm action={createAndLinkContact} submitLabel="Create and add" pendingLabel="Adding…" onDone={onDone} secondary={cancel}>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <Alert role="note">Check the other list first so the same person is not added twice. A new person is also added to Clients and can be put on other opportunities.</Alert>
      <Field label="Organisation" htmlFor="new-contact-org" hint="The agency or client this person works for.">
        <Select id="new-contact-org" name="organisationId" defaultValue={picker.defaultOrganisationId ?? ""}>
          <option value="">No organisation yet</option>
          {picker.organisations.map((o) => <option key={o.id} value={o.id}>{o.name} ({KIND_LABEL[o.kind]})</option>)}
        </Select>
      </Field>
      <Field label="Name" htmlFor="new-contact-name"><Input id="new-contact-name" name="name" required maxLength={200} autoComplete="off" /></Field>
      <Field label="Job title (optional)" htmlFor="new-contact-title"><Input id="new-contact-title" name="roleTitle" maxLength={200} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email (optional)" htmlFor="new-contact-email"><Input id="new-contact-email" name="email" type="email" autoComplete="off" /></Field>
        <Field label="Phone (optional)" htmlFor="new-contact-phone"><Input id="new-contact-phone" name="phone" type="tel" autoComplete="off" /></Field>
      </div>
      <Field label="Role on this opportunity (optional)" htmlFor="new-contact-role"><Input id="new-contact-role" name="role" maxLength={120} /></Field>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Per-contact actions
// ---------------------------------------------------------------------------------------------------------------

export interface ContactActionsProps {
  opportunityId: string;
  contact: { id: string; name: string; roleTitle: string | null; email: string | null; phone: string | null };
  role: string | null;
  /** May link, unlink and re-role contacts on this opportunity. */
  canChange: boolean;
  /** May edit the shared record itself. */
  canEditRecord: boolean;
}

type Dialog = "role" | "remove" | "edit" | null;

export function ContactActions({ opportunityId, contact, role, canChange, canEditRecord }: ContactActionsProps) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const cancel = <Button type="button" variant="ghost" onClick={close}>Cancel</Button>;
  if (!canChange && !canEditRecord) return null;
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/70 pt-3">
        {canChange ? <Button type="button" size="sm" variant="outline" onClick={() => setDialog("role")} aria-label={`Change role of ${contact.name} on this opportunity`}>Change role</Button> : null}
        {canEditRecord ? <Button type="button" size="sm" variant="outline" onClick={() => setDialog("edit")} aria-label={`Edit contact details of ${contact.name}`}>Edit contact details</Button> : null}
        {canChange ? <Button type="button" size="sm" variant="ghost" onClick={() => setDialog("remove")} aria-label={`Remove ${contact.name} from this opportunity`}>Remove from this opportunity</Button> : null}
      </div>

      <Modal open={dialog === "role"} onClose={close} title={`Role of ${contact.name}`} description="Their role on this opportunity only. It does not change the person's details anywhere else.">
        <ActionForm action={linkContact} submitLabel="Save role" onDone={close} secondary={cancel}>
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <input type="hidden" name="contactId" value={contact.id} />
          <Field label="Role on this opportunity" htmlFor="contact-role" hint="Leave empty to record no role.">
            <Input id="contact-role" name="role" defaultValue={role ?? ""} maxLength={120} />
          </Field>
        </ActionForm>
      </Modal>

      <Modal open={dialog === "edit"} onClose={close} title={`Edit details of ${contact.name}`}>
        <ActionForm action={updateContact} submitLabel="Save for everyone" pendingLabel="Saving…" onDone={close} secondary={cancel}>
          <Alert variant="warning" role="note">
            <strong>This changes the shared record.</strong> {contact.name} appears on every opportunity they are on and in Clients, and the new details show everywhere. Each of those opportunities records the change in its history. To take them off only this opportunity, use Remove instead.
          </Alert>
          <input type="hidden" name="contactId" value={contact.id} />
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <Field label="Name" htmlFor="edit-contact-name"><Input id="edit-contact-name" name="name" defaultValue={contact.name} required maxLength={200} /></Field>
          <Field label="Job title (optional)" htmlFor="edit-contact-title"><Input id="edit-contact-title" name="roleTitle" defaultValue={contact.roleTitle ?? ""} maxLength={200} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email (optional)" htmlFor="edit-contact-email"><Input id="edit-contact-email" name="email" type="email" defaultValue={contact.email ?? ""} autoComplete="off" /></Field>
            <Field label="Phone (optional)" htmlFor="edit-contact-phone"><Input id="edit-contact-phone" name="phone" type="tel" defaultValue={contact.phone ?? ""} autoComplete="off" /></Field>
          </div>
        </ActionForm>
      </Modal>

      <Modal open={dialog === "remove"} onClose={close} title={`Remove ${contact.name} from this opportunity?`}>
        <RemoveConfirm opportunityId={opportunityId} contactId={contact.id} name={contact.name} onDone={close} cancel={cancel} />
      </Modal>
    </>
  );
}

function RemoveConfirm({ opportunityId, contactId, name, onDone, cancel }: { opportunityId: string; contactId: string; name: string; onDone: () => void; cancel: React.ReactNode }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-sm">This only takes {name} off this opportunity. The contact record itself is kept: {name} still appears on any other opportunities they are on and in Clients. You can add them back at any time.</p>
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {cancel}
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await unlinkContact(opportunityId, contactId);
              if (r.error) setError(r.error);
              else onDone();
            });
          }}
        >
          {pending ? "Removing…" : "Remove from this opportunity"}
        </Button>
      </div>
    </div>
  );
}
