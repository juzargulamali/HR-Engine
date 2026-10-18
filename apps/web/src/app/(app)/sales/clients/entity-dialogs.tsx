"use client";

import { useEffect, useState } from "react";
import { createContact, createOrganisation, findSimilarOrganisations } from "@/lib/actions/crm";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";

type S = ActionState & { id?: string };

export const ORGANISATION_KIND_LABEL = { agency: "Agency", client: "End client", direct: "Direct client" } as const;
export type OrganisationKind = keyof typeof ORGANISATION_KIND_LABEL;

export interface CreatedOrganisation {
  id: string;
  name: string;
  kind: OrganisationKind;
  place: string | null;
}

export interface CreatedContact {
  id: string;
  name: string;
  organisationId: string | null;
  roleTitle: string | null;
}

interface SimilarOrganisation {
  id: string;
  name: string;
  kind: string;
  place: string | null;
}

/**
 * Add an organisation. While the name is typed we ask the database for organisations with a similar name, so the same
 * agency is not entered twice under slightly different spellings. The hint never blocks saving. Inputs are controlled
 * so a refused save (React resets uncontrolled form fields after every action) keeps what the person typed.
 */
export function AddOrganisationDialog({
  open, onClose, defaultKind = "client", onCreated, onUseExisting,
}: {
  open: boolean;
  onClose: () => void;
  defaultKind?: OrganisationKind;
  onCreated?: (org: CreatedOrganisation) => void;
  /** When given, similar organisations get a "Use this one" button that hands back the existing id. */
  onUseExisting?: (org: SimilarOrganisation) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add organisation" description="An agency, an end client, or a client you deal with directly.">
      <OrganisationForm onClose={onClose} defaultKind={defaultKind} onCreated={onCreated} onUseExisting={onUseExisting} />
    </Modal>
  );
}

function OrganisationForm({
  onClose, defaultKind, onCreated, onUseExisting,
}: {
  onClose: () => void;
  defaultKind: OrganisationKind;
  onCreated?: (org: CreatedOrganisation) => void;
  onUseExisting?: (org: SimilarOrganisation) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<OrganisationKind>(defaultKind);
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [similar, setSimilar] = useState<SimilarOrganisation[]>([]);

  useEffect(() => {
    if (name.trim().length < 3) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      findSimilarOrganisations(name)
        .then((rows) => { if (!cancelled) setSimilar(rows); })
        .catch(() => { if (!cancelled) setSimilar([]); });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name]);

  const similarShown = name.trim().length >= 3 ? similar : [];

  const action = async (prev: S, fd: FormData): Promise<S> => {
    const result = await createOrganisation(prev, fd);
    // Read from the submitted form, not from state, so the values are exactly what was sent.
    if (!result.error && result.id) {
      onCreated?.({ id: result.id, name: String(fd.get("name") ?? "").trim(), kind: String(fd.get("kind")) as OrganisationKind, place: String(fd.get("place") ?? "").trim() || null });
    }
    return result;
  };

  return (
    <ActionForm action={action} submitLabel="Add organisation" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
      <Field label="Name" htmlFor="org-name">
        <Input id="org-name" name="name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      {similarShown.length > 0 ? (
        <div role="status" className="space-y-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          <p className="font-medium">Organisations with a similar name already exist. Check before adding another.</p>
          <ul className="space-y-1.5">
            {similarShown.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  {s.name}
                  <span className="text-muted-foreground"> · {ORGANISATION_KIND_LABEL[s.kind as OrganisationKind] ?? s.kind}{s.place ? ` · ${s.place}` : ""}</span>
                </span>
                {onUseExisting ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => { onUseExisting(s); onClose(); }}>Use this one</Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Field label="Type" htmlFor="org-kind">
        <Select id="org-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as OrganisationKind)}>
          {(Object.keys(ORGANISATION_KIND_LABEL) as OrganisationKind[]).map((k) => <option key={k} value={k}>{ORGANISATION_KIND_LABEL[k]}</option>)}
        </Select>
      </Field>
      <Field label="City or country (optional)" htmlFor="org-place">
        <Input id="org-place" name="place" value={place} onChange={(e) => setPlace(e.target.value)} />
      </Field>
      <Field label="Note (optional)" htmlFor="org-note" hint="For example how they usually buy, or who introduced them.">
        <Input id="org-note" name="note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </ActionForm>
  );
}

/** Add a contact, optionally under an organisation. A contact only needs a name; email and phone are checked when given. */
export function AddContactDialog({
  open, onClose, organisations, defaultOrganisationId, allowNoOrganisation = true, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  organisations: { id: string; name: string }[];
  defaultOrganisationId?: string | null;
  /** False when the contact must belong to one of `organisations` (for example while recording an enquiry). */
  allowNoOrganisation?: boolean;
  onCreated?: (contact: CreatedContact) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add contact" description="A person at an agency or client. Only the name is required.">
      <ContactForm onClose={onClose} organisations={organisations} defaultOrganisationId={defaultOrganisationId ?? ""} allowNoOrganisation={allowNoOrganisation} onCreated={onCreated} />
    </Modal>
  );
}

function ContactForm({
  onClose, organisations, defaultOrganisationId, allowNoOrganisation, onCreated,
}: {
  onClose: () => void;
  organisations: { id: string; name: string }[];
  defaultOrganisationId: string;
  allowNoOrganisation: boolean;
  onCreated?: (contact: CreatedContact) => void;
}) {
  const [organisationId, setOrganisationId] = useState(defaultOrganisationId || (allowNoOrganisation ? "" : (organisations[0]?.id ?? "")));
  const [name, setName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const action = async (prev: S, fd: FormData): Promise<S> => {
    const result = await createContact(prev, fd);
    if (!result.error && result.id) {
      onCreated?.({ id: result.id, name: String(fd.get("name") ?? "").trim(), organisationId: String(fd.get("organisationId") ?? "") || null, roleTitle: String(fd.get("roleTitle") ?? "").trim() || null });
    }
    return result;
  };

  return (
    <ActionForm action={action} submitLabel="Add contact" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
      <Field label="Organisation" htmlFor="contact-org">
        <Select id="contact-org" name="organisationId" value={organisationId} onChange={(e) => setOrganisationId(e.target.value)}>
          {allowNoOrganisation ? <option value="">No organisation</option> : null}
          {organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
      </Field>
      <Field label="Name" htmlFor="contact-name">
        <Input id="contact-name" name="name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Role (optional)" htmlFor="contact-role">
        <Input id="contact-role" name="roleTitle" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="e.g. Producer" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email (optional)" htmlFor="contact-email">
          <Input id="contact-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Phone (optional)" htmlFor="contact-phone">
          <Input id="contact-phone" name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
        </Field>
      </div>
    </ActionForm>
  );
}
