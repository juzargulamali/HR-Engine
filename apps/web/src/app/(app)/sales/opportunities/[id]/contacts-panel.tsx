import { Mail, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OpportunityDetail } from "@/lib/crm/data";
import { contactsAccessNote, type ContactPickerData } from "./contact-helpers";
import { AddContactButton, ContactActions } from "./contact-forms";
import { Muted } from "./parts";
import { canEditSharedContact, type OppView } from "./view";

const KIND_LABEL = { agency: "Agency", client: "End client", direct: "Direct client" } as const;
const LINK = "inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Everything needed to reach each person. The links open your own phone or mail app; nothing is sent from here.
 * With `manage`, people allowed to change who is on the opportunity can add, re-role and remove contacts, and those
 * allowed to edit the shared record can edit its details; everyone else gets the list and one line saying why.
 * Without it (e.g. the handover page) the list is read-only and says nothing more.
 */
export function ContactsPanel({ contacts, manage }: { contacts: OpportunityDetail["contacts"]; manage?: { view: OppView; picker: ContactPickerData | null } }) {
  const view = manage?.view;
  const canChange = !!view?.canChangeContacts;
  const note = view ? contactsAccessNote({ isLost: view.isLost, canChange }) : null;
  const picker = manage?.picker ?? null;
  const list = contacts.length === 0 ? (
    <Muted>No contacts are linked to this opportunity yet.</Muted>
  ) : (
    <ul className="grid gap-3 md:grid-cols-2">
      {contacts.map(({ contact, role, organisation }) => (
        <li key={contact.id} className="min-w-0 rounded-lg border border-border p-3.5">
          <p className="break-words text-sm font-semibold">{contact.name}</p>
          {contact.role_title ? <p className="break-words text-sm">{contact.role_title}</p> : null}
          {organisation ? <p className="break-words text-sm text-muted-foreground">{organisation.name}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {organisation ? <Badge variant="outline">{KIND_LABEL[organisation.kind]} contact</Badge> : null}
            {role ? <Badge variant="secondary">{role}</Badge> : null}
          </div>
          <dl className="mt-3 space-y-2.5 border-t border-border/70 pt-3 text-sm">
            <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2">
              <dt className="pt-0.5 text-xs text-muted-foreground">Phone</dt>
              <dd className="min-w-0">
                {contact.phone ? (
                  <>
                    <p className="break-words tabular-nums [overflow-wrap:anywhere]">{contact.phone}</p>
                    <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className={`${LINK} mt-1.5`}><Phone className="h-3.5 w-3.5" aria-hidden /> Call</a>
                  </>
                ) : <span className="text-muted-foreground">Not recorded</span>}
              </dd>
            </div>
            <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2">
              <dt className="pt-0.5 text-xs text-muted-foreground">Email</dt>
              <dd className="min-w-0">
                {contact.email ? (
                  <>
                    <p className="break-words [overflow-wrap:anywhere]">{contact.email}</p>
                    <a href={`mailto:${contact.email}`} className={`${LINK} mt-1.5`}><Mail className="h-3.5 w-3.5" aria-hidden /> Email</a>
                  </>
                ) : <span className="text-muted-foreground">Not recorded</span>}
              </dd>
            </div>
          </dl>
          {view ? (
            <ContactActions
              opportunityId={view.opp.id}
              contact={{ id: contact.id, name: contact.name, roleTitle: contact.role_title, email: contact.email, phone: contact.phone }}
              role={role}
              canChange={canChange}
              canEditRecord={canEditSharedContact(view, contact.created_by)}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
  if (!view) return list;
  return (
    <div className="space-y-3">
      {canChange && picker ? <div className="flex justify-end"><AddContactButton opportunityId={view.opp.id} picker={picker} /></div> : null}
      {note ? <Muted>{note}</Muted> : null}
      {list}
    </div>
  );
}
