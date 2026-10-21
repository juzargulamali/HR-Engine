"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Plus, TriangleAlert, X } from "lucide-react";
import { CRM_SOURCES, crmStageLabel, type DuplicateMatch } from "@enginious-hr/domain";
import { checkDuplicates, createOpportunity } from "@/lib/actions/crm";
import type { ActionState } from "@/lib/actions/companies";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/sales/action-form";
import { cn } from "@/lib/utils";
import {
  AddContactDialog, AddOrganisationDialog, ORGANISATION_KIND_LABEL,
  type CreatedContact, type CreatedOrganisation, type OrganisationKind,
} from "../clients/entity-dialogs";
import { parseTechnologyRows, type TechnologyRow } from "./technologies";

export interface EnquiryCompany {
  id: string;
  name: string;
  /** The company's default quote currency, or null when it has no Sales settings yet. */
  currency: string | null;
  hasSettings: boolean;
  /** May assign the owner of a new enquiry (assign_owner or founder). */
  canAssignOwner: boolean;
  /** May open Settings to set the company up (manage_settings or founder). */
  canOpenSettings: boolean;
  people: { id: string; name: string }[];
}

export interface EnquiryOrganisation {
  id: string;
  name: string;
  kind: OrganisationKind;
  place: string | null;
}

export interface EnquiryContact {
  id: string;
  name: string;
  organisationId: string | null;
  roleTitle: string | null;
}

const initialState: ActionState = { error: null };

const NEXT_KINDS = [["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["proposal", "Proposal work"], ["other", "Other"]] as const;
const CURRENCY_SUGGESTIONS = ["AED", "SAR", "EUR", "USD", "GBP"];

let techKey = 1;
const emptyTechRow = (): TechnologyRow => ({ key: techKey++, name: "", qty: "1" });

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/** A plain select with a small search box above it (the list of organisations gets long). */
export function OrganisationPicker({
  id, name, label, hint, value, onChange, organisations, preferredKinds, onAdd,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  value: string;
  onChange: (id: string) => void;
  organisations: EnquiryOrganisation[];
  preferredKinds: OrganisationKind[];
  onAdd: () => void;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const matching = organisations.filter((o) => needle === "" || `${o.name} ${o.place ?? ""}`.toLowerCase().includes(needle));
  const visible = organisations.filter((o) => o.id === value || matching.includes(o));
  const preferred = visible.filter((o) => preferredKinds.includes(o.kind));
  const others = visible.filter((o) => !preferredKinds.includes(o.kind));
  const option = (o: EnquiryOrganisation) => <option key={o.id} value={o.id}>{o.name}{o.place ? ` (${o.place})` : ""}</option>;
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium leading-none">{label}</label>
      <Input aria-label={`Search ${label.toLowerCase()}`} type="search" placeholder="Type to narrow the list" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
      <Select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        {preferred.length > 0 ? <optgroup label={preferredKinds.map((k) => ORGANISATION_KIND_LABEL[k]).join(" / ")}>{preferred.map(option)}</optgroup> : null}
        {others.length > 0 ? <optgroup label="Other organisations">{others.map(option)}</optgroup> : null}
      </Select>
      {needle !== "" && matching.length === 0 ? <p className="text-sm text-muted-foreground">Nothing matches “{search.trim()}”. Add it as a new organisation below.</p> : null}
      <p className="text-sm text-muted-foreground">{hint}</p>
      <Button type="button" size="sm" variant="ghost" onClick={onAdd}><Plus className="h-4 w-4" aria-hidden /> Add organisation</Button>
    </div>
  );
}

export function DuplicateWarning({ matches, onDismiss }: { matches: DuplicateMatch[]; onDismiss: (id: string) => void }) {
  if (matches.length === 0) return null;
  return (
    <section aria-label="Possible duplicate enquiry" role="status" className="space-y-3 rounded-lg border border-warning/50 bg-warning/10 p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><TriangleAlert className="h-4 w-4" aria-hidden /> This may be the same enquiry</h2>
        <p className="mt-1 text-sm">Check the {matches.length === 1 ? "enquiry" : "enquiries"} below before saving. Several enquiries from the same agency or client are normal, so you can still save this one. Nothing is merged for you.</p>
      </div>
      <ul className="space-y-3">
        {matches.map((m) => (
          <li key={m.candidate.id} className="rounded-md border border-border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/sales/opportunities/${m.candidate.id}`} target="_blank" rel="noopener noreferrer" className="break-words font-medium underline-offset-2 hover:underline">
                  {m.candidate.reference} · {m.candidate.title ?? "Untitled enquiry"}<span className="sr-only"> (opens in a new tab)</span>
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline" className="whitespace-nowrap">{m.level === "likely" ? "Likely the same" : "Possibly the same"}</Badge>
                  <span>Stage: {crmStageLabel(m.candidate.stage)}</span>
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => onDismiss(m.candidate.id)}>
                <X className="h-3.5 w-3.5" aria-hidden /> Not the same
              </Button>
            </div>
            {m.reasons.length > 0 ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {m.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NewEnquiryForm({
  companies, organisations: serverOrganisations, contacts: serverContacts, currentUserId, currentUserName, today,
}: {
  companies: EnquiryCompany[];
  organisations: EnquiryOrganisation[];
  contacts: EnquiryContact[];
  currentUserId: string;
  currentUserName: string;
  /** Today's date in Dubai (YYYY-MM-DD), decided on the server so the page does not differ between server and browser. */
  today: string;
}) {
  const [state, formAction, pending] = useActionState(createOpportunity, initialState);
  const [clientError, setClientError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const [companyId, setCompanyId] = useState((companies.find((c) => c.hasSettings) ?? companies[0])?.id ?? "");
  const company = companies.find((c) => c.id === companyId) ?? null;

  // Organisations / contacts added from this page are kept locally until the server data catches up.
  const [addedOrgs, setAddedOrgs] = useState<EnquiryOrganisation[]>([]);
  const [addedContacts, setAddedContacts] = useState<EnquiryContact[]>([]);
  const organisations = useMemo(() => {
    const known = new Set(serverOrganisations.map((o) => o.id));
    return [...serverOrganisations, ...addedOrgs.filter((o) => !known.has(o.id))].sort((a, b) => a.name.localeCompare(b.name));
  }, [serverOrganisations, addedOrgs]);
  const contacts = useMemo(() => {
    const known = new Set(serverContacts.map((c) => c.id));
    return [...serverContacts, ...addedContacts.filter((c) => !known.has(c.id))];
  }, [serverContacts, addedContacts]);

  const [title, setTitle] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const [clientId, setClientId] = useState("");
  const [checkedContacts, setCheckedContacts] = useState<Set<string>>(new Set());
  const [eventStart, setEventStart] = useState("");
  const [installStart, setInstallStart] = useState("");
  const [location, setLocation] = useState("");
  const [techRows, setTechRows] = useState<TechnologyRow[]>(() => [emptyTechRow()]);
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  const [ownerChoice, setOwnerChoice] = useState(currentUserId);

  const [orgDialog, setOrgDialog] = useState<null | "agency" | "client">(null);
  const [contactDialog, setContactDialog] = useState(false);

  const currency = currencyOverride ?? company?.currency ?? "";
  const people = useMemo(() => {
    const list = company?.people ?? [];
    return list.some((p) => p.id === currentUserId) ? list : [{ id: currentUserId, name: currentUserName }, ...list];
  }, [company, currentUserId, currentUserName]);
  const owner = people.some((p) => p.id === ownerChoice) ? ownerChoice : currentUserId;

  const selectedOrgs = organisations.filter((o) => o.id === agencyId || o.id === clientId);
  const selectedOrgIds = new Set(selectedOrgs.map((o) => o.id));
  const visibleContacts = contacts.filter((c) => c.organisationId && selectedOrgIds.has(c.organisationId));

  const tech = useMemo(() => parseTechnologyRows(techRows), [techRows]);

  // Duplicate check: debounced, on the things that identify the job. Organisation overlap alone never flags (domain scoring).
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const hasSignal = !!agencyId || !!clientId || !!eventStart || !!installStart || location.trim() !== "";
  useEffect(() => {
    if (!hasSignal) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkDuplicates({
        agencyOrgId: agencyId || null,
        clientOrgId: clientId || null,
        title,
        eventStart: eventStart || null,
        installStart: installStart || null,
        location: location.trim() || null,
        technologies: tech.items.filter((t) => t.qty >= 1),
      })
        .then((found) => { if (!cancelled) setMatches(found); })
        .catch(() => { if (!cancelled) setMatches([]); });
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasSignal, agencyId, clientId, title, eventStart, installStart, location, tech.items]);
  const shownMatches = (hasSignal ? matches : []).filter((m) => !dismissed.has(m.candidate.id));

  const error = clientError ?? state.error;
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error, state]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);
    if (!company) return setClientError("Choose the company this enquiry is for.");
    if (!company.hasSettings) return setClientError(`${company.name} has no Sales settings yet, so an enquiry cannot be recorded for it.`);
    if (!agencyId && !clientId) return setClientError("Choose an agency, an end client, or both. An enquiry needs at least one of them. Contacts are optional.");
    if (tech.error) return setClientError(tech.error);
    const data = new FormData(e.currentTarget);
    // Not <form action>: React would reset every field after a refused save and the person would lose their typing.
    startTransition(() => formAction(data));
  }

  function toggleContact(id: string, on: boolean) {
    setCheckedContacts((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  function addOrganisation(side: "agency" | "client", org: CreatedOrganisation) {
    setAddedOrgs((prev) => [...prev, { id: org.id, name: org.name, kind: org.kind, place: org.place }]);
    if (side === "agency") setAgencyId(org.id); else setClientId(org.id);
  }

  const blocked = !company || !company.hasSettings;

  return (
    <>
      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {company && !company.hasSettings ? (
            <Alert variant="warning">
              <strong>{company.name}</strong> has no Sales settings yet (reference code and default currency), so enquiries cannot be recorded for it.{" "}
              {company.canOpenSettings ? <Link href="/sales/settings" className="font-medium underline underline-offset-2">Set it up in Settings</Link> : "Ask a founder to set it up in Sales settings."}
            </Alert>
          ) : null}

          <Section title="The enquiry" description="Three things are needed here. Leave anything you do not know blank further down.">
            <Field label="Company" htmlFor="enq-company" hint="Only companies you have Sales access to are listed.">
              <Select id="enq-company" name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.hasSettings ? "" : " (no Sales settings yet)"}</option>)}
              </Select>
            </Field>
            <Field label="Requirement" htmlFor="enq-title" hint="A title or one-line brief, for example “LED tunnel for a mall activation”.">
              <Input id="enq-title" name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Where did it come from?" htmlFor="enq-source">
              <Select id="enq-source" name="source" required defaultValue="">
                <option value="" disabled>Choose a source…</option>
                {CRM_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>
          </Section>

          <Section title="Who is it from?" description="An enquiry needs an agency or an end client, or both. Contacts are optional.">
            <fieldset className="space-y-4">
              <legend className="sr-only">Agency and end client (at least one is required)</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <OrganisationPicker
                  id="enq-agency" name="agencyOrgId" label="Agency" hint="The agency that sent the brief, if there is one."
                  value={agencyId} onChange={setAgencyId} organisations={organisations} preferredKinds={["agency"]} onAdd={() => setOrgDialog("agency")}
                />
                <OrganisationPicker
                  id="enq-client" name="clientOrgId" label="End client" hint="The brand or company the work is for."
                  value={clientId} onChange={setClientId} organisations={organisations} preferredKinds={["client", "direct"]} onAdd={() => setOrgDialog("client")}
                />
              </div>
              {!agencyId && !clientId ? <p className="text-sm text-muted-foreground">Required: choose at least one of agency or end client.</p> : null}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Contacts on this enquiry (optional)</legend>
              {visibleContacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{selectedOrgs.length === 0 ? "Choose an agency or end client to see their contacts." : "No contacts recorded for the chosen organisations yet."}</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {visibleContacts.map((c) => {
                    const org = organisations.find((o) => o.id === c.organisationId);
                    return (
                      <li key={c.id}>
                        <label className="flex min-w-0 items-start gap-2 rounded-md border border-border p-2.5 text-sm">
                          <input type="checkbox" name="contactIds" value={c.id} checked={checkedContacts.has(c.id)} onChange={(e) => toggleContact(c.id, e.target.checked)} className="mt-0.5" />
                          <span className="min-w-0 break-words">
                            <span className="font-medium">{c.name}</span>
                            <span className="block text-sm text-muted-foreground">{[c.roleTitle, org?.name].filter(Boolean).join(" · ")}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Button type="button" size="sm" variant="ghost" disabled={selectedOrgs.length === 0} onClick={() => setContactDialog(true)}>
                <Plus className="h-4 w-4" aria-hidden /> Add contact
              </Button>
              {selectedOrgs.length === 0 ? <p className="text-sm text-muted-foreground">Choose an agency or end client first, then add contacts to it.</p> : null}
            </fieldset>
          </Section>

          <DuplicateWarning matches={shownMatches} onDismiss={(id) => setDismissed((prev) => new Set(prev).add(id))} />

          <Section title="Next action and owner" description="Every enquiry needs an owner and a next step with a date, so nothing is left waiting.">
            <Field label="Next action" htmlFor="enq-next-title" hint="For example “Call to qualify the brief”.">
              <Input id="enq-next-title" name="nextTitle" required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Date" htmlFor="enq-next-date">
                <Input id="enq-next-date" name="nextDate" type="date" required min={today} defaultValue={today} />
              </Field>
              <Field label="Time (Dubai)" htmlFor="enq-next-time">
                <Input id="enq-next-time" name="nextTime" type="time" defaultValue="10:00" />
              </Field>
              <Field label="Type" htmlFor="enq-next-kind">
                <Select id="enq-next-kind" name="nextKind" defaultValue="call">{NEXT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
              </Field>
            </div>
            {company?.canAssignOwner ? (
              <Field label="Owner" htmlFor="enq-owner" hint="You can give the enquiry to a colleague with Sales access to this company. They are then responsible for it.">
                <Select id="enq-owner" name="ownerId" value={owner} onChange={(e) => setOwnerChoice(e.target.value)}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === currentUserId ? " (me)" : ""}</option>)}
                </Select>
              </Field>
            ) : (
              <p className="text-sm"><span className="font-medium">Owner:</span> you. Only a founder or someone allowed to assign owners can give an enquiry to a colleague.</p>
            )}
          </Section>

          <Section title="Job details" description="Optional. Add what you know now; everything can be edited later.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Event start" htmlFor="enq-event-start">
                <Input id="enq-event-start" name="eventStart" type="date" value={eventStart} onChange={(e) => setEventStart(e.target.value)} />
              </Field>
              <Field label="Event end" htmlFor="enq-event-end">
                <Input id="enq-event-end" name="eventEnd" type="date" min={eventStart || undefined} />
              </Field>
              <Field label="Installation date" htmlFor="enq-install">
                <Input id="enq-install" name="installStart" type="date" value={installStart} onChange={(e) => setInstallStart(e.target.value)} />
              </Field>
            </div>
            <Field label="Location" htmlFor="enq-location" hint="Venue or city.">
              <Input id="enq-location" name="location" value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Technologies requested</legend>
              <input type="hidden" name="technologies" value={JSON.stringify(tech.items)} />
              <ul className="space-y-2">
                {techRows.map((row, i) => (
                  <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-center gap-2">
                    <Input aria-label={`Technology ${i + 1}`} placeholder="e.g. LED wall" value={row.name} onChange={(e) => setTechRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))} />
                    <Input aria-label={`Quantity of technology ${i + 1}`} type="number" inputMode="numeric" min={1} step={1} value={row.qty} onChange={(e) => setTechRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, qty: e.target.value } : r)))} />
                    <Button type="button" size="sm" variant="ghost" aria-label={`Remove technology ${i + 1}`} onClick={() => setTechRows((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== row.key) : [emptyTechRow()]))}>
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
              {tech.error ? <p role="alert" className="text-sm text-destructive">{tech.error}</p> : null}
              <Button type="button" size="sm" variant="ghost" onClick={() => setTechRows((rows) => [...rows, emptyTechRow()])}><Plus className="h-4 w-4" aria-hidden /> Add technology</Button>
            </fieldset>

            <Field label="Waiting on" htmlFor="enq-waiting" hint="Who the next move depends on. Leave blank if nobody.">
              <Select id="enq-waiting" name="waitingOn" defaultValue="">
                <option value="">Nobody</option>
                <option value="client">The client</option>
                <option value="internal">Our own team</option>
              </Select>
            </Field>
            <Field label="Brief" htmlFor="enq-brief" hint="What the client asked for, in their words if you can.">
              <Textarea id="enq-brief" name="brief" rows={3} />
            </Field>
            <Field label="Scope" htmlFor="enq-scope" hint="What we would supply and do.">
              <Textarea id="enq-scope" name="scope" rows={3} />
            </Field>
          </Section>

          <Section title="Budget" description="Optional. A value you have been given or an estimate. It is never added across currencies.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Budget or value" htmlFor="enq-value">
                <Input id="enq-value" name="value" type="number" inputMode="decimal" min={0} step="0.01" />
              </Field>
              <Field label="Currency" htmlFor="enq-currency" hint={company?.currency ? `Defaults to ${company.name}'s quote currency (${company.currency}). Any 3-letter code works.` : "Any 3-letter code, for example AED."}>
                <Input id="enq-currency" name="currency" list="enq-currencies" maxLength={3} pattern="[A-Za-z]{3}" title="A 3-letter currency code, for example AED" value={currency} onChange={(e) => setCurrencyOverride(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" />
                <datalist id="enq-currencies">{CURRENCY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
            </div>
            <Field label="Budget note" htmlFor="enq-budget-note" hint="For example “about 150k, flexible” or “client has not shared a budget”.">
              <Input id="enq-budget-note" name="budgetNote" />
            </Field>
          </Section>

          <div ref={errorRef} tabIndex={-1} className="outline-none" aria-live="polite">
            {error ? <Alert variant="destructive">{error}</Alert> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || blocked}>{pending ? "Saving…" : "Record enquiry"}</Button>
            <Link href="/sales/opportunities" className={cn(buttonVariants({ variant: "ghost" }))}>Cancel</Link>
          </div>
        </div>

        <aside aria-label="What happens next" className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">What happens next</CardTitle></CardHeader>
            <CardContent>
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                <li>It starts as a new enquiry with its own reference.</li>
                <li>The owner is responsible for it. Unless you assign someone else, that is you.</li>
                <li>Your next action appears in the owner&apos;s follow-ups with the date and time you set.</li>
                <li>If a similar enquiry exists you will see a warning. You can still save.</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </form>

      <AddOrganisationDialog
        open={orgDialog !== null}
        onClose={() => setOrgDialog(null)}
        defaultKind={orgDialog === "agency" ? "agency" : "client"}
        onCreated={(org) => addOrganisation(orgDialog ?? "client", org)}
        onUseExisting={(org) => { if (orgDialog === "agency") setAgencyId(org.id); else setClientId(org.id); }}
      />
      <AddContactDialog
        open={contactDialog}
        onClose={() => setContactDialog(false)}
        organisations={selectedOrgs.map((o) => ({ id: o.id, name: o.name }))}
        defaultOrganisationId={clientId || agencyId}
        allowNoOrganisation={false}
        onCreated={(c: CreatedContact) => {
          setAddedContacts((prev) => [...prev, c]);
          setCheckedContacts((prev) => new Set(prev).add(c.id));
        }}
      />
    </>
  );
}
