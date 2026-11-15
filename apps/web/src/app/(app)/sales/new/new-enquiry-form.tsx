"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Plus, TriangleAlert, X } from "lucide-react";
import { useSubmissionKey } from "@/components/sales/use-submission-key";
import { CRM_SOURCES, crmStageLabel, type DuplicateMatch } from "@enginious-hr/domain";
import { checkDuplicates, createOpportunity } from "@/lib/actions/crm";
import type { ActionState } from "@/lib/actions/companies";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/sales/action-form";
import { cn } from "@/lib/utils";
import { FIELD_NOUN, hasRoleFor, offeredFor, type InquiryField } from "@/lib/crm/organisation-roles";
import { focusComboQuietly, SearchCombobox, type ComboOption } from "@/components/sales/combobox";
import { ACTIVE_COMPANY_WHY, type ActiveCompanySource } from "@/lib/crm/active-company";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import type { EditionOption } from "@/lib/crm/events/data";
import type { EventChoice } from "@/lib/crm/events/model";
import { EventEditionDialog, useCreatedEditions } from "@/components/sales/event-edition-dialog";
import { useEditionDates } from "@/components/sales/use-edition-dates";
import {
  AddContactDialog, AddOrganisationDialog,
  type CreatedContact, type CreatedOrganisation, type OrganisationKind,
} from "../clients/entity-dialogs";
import { parseTechnologyRows, type TechnologyRow } from "./technologies";
import {
  CARRY_KEY, CURRENCY_SUGGESTIONS, DEFAULT_NEXT_KIND, DEFAULT_NEXT_TIME, DUE_TIME_LABEL, ENQUIRY_HELP, ENQUIRY_LABELS, NEXT_KINDS, currencyNote, enquiryBlockedReason, hasPrefill,
  readCarried, resolveCurrency, startingCompanyId, type CurrencyState, type EnquiryPrefill,
} from "./enquiry-form-shared";

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
  /** Every role the record holds (agency, direct, client, technology). Empty = none recorded: it reads as its `kind`. */
  roles?: readonly string[];
  place: string | null;
  /** Two-letter country and website, shown under the name so two similar names can be told apart (optional: an older caller may not give them). */
  country?: string | null;
  website?: string | null;
}

export interface EnquiryContact {
  id: string;
  name: string;
  organisationId: string | null;
  roleTitle: string | null;
}

const initialState: ActionState & { existingEnquiryId?: string } = { error: null };


let techKey = 1;
const emptyTechRow = (): TechnologyRow => ({ key: techKey++, name: "", qty: "1" });

function Section({ title, description, help, children }: { title: string; description?: string; /** Optional explanation: behind an ⓘ beside the title. */ help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-1.5">{title}{help ? <InfoHint label={title}>{help}</InfoHint> : null}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/** What tells two similar organisations apart: country (or place) and website, in words. */
export const organisationDetail = (o: Pick<EnquiryOrganisation, "place" | "country" | "website">): string =>
  [o.country ? countryLabel(o.country) : o.place, o.website ? o.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/.*$/, "") : null].filter(Boolean).join(" · ");

/**
 * ONE search-as-you-type field (no separate search box and dropdown): type, see the matches directly below, choose by mouse, touch or keyboard. It offers only
 * organisations that hold the role this field needs: an organisation recorded as both an agency and an end client appears in BOTH fields, one recorded as neither does
 * not appear. Typing alone never selects or creates anything. The shared directory is searched (every company's accounts).
 */
export function OrganisationPicker({
  id, name, label, hint, help, value, onChange, organisations, field, onAdd,
}: {
  id: string;
  name: string;
  label: string;
  /** Always visible under the field: only for what a person must read to fill it in. */
  hint?: string;
  /** Behind the ⓘ beside the label. */
  help?: React.ReactNode;
  value: string;
  onChange: (id: string) => void;
  organisations: EnquiryOrganisation[];
  field: InquiryField;
  onAdd: () => void;
}) {
  const options = useMemo<ComboOption[]>(() => offeredFor(organisations, field, value).map((o) => ({ id: o.id, label: o.name, detail: organisationDetail(o) })), [organisations, field, value]);
  return (
    <SearchCombobox
      id={id} name={name} label={label} hint={hint || undefined} help={help} options={options} value={value} onChange={onChange} placeholder="Type a name to search"
      emptyText={(q) => `Nothing recorded as ${FIELD_NOUN[field]} matches “${q}”. Add it as a new organisation below, or give an existing one that role on its account page.`}
      footer={<Button type="button" size="sm" variant="ghost" onClick={onAdd}><Plus className="h-4 w-4" aria-hidden /> Add organisation</Button>}
    />
  );
}

/** The optional Event / Exhibition field: one specific edition from the shared database ("GITEX Global · 2027 · Dubai"). Nothing is guessed from old free text. */
export function EventEditionPicker({ id, name = "eventEditionId", value, onChange, editions, loadError, onCreate }: {
  id: string; name?: string; value: string; onChange: (id: string) => void; editions: readonly EditionOption[]; loadError?: boolean;
  /** Opens the form that adds a missing event or edition, with the text typed so far. Leave out where nothing can be added from the field. */
  onCreate?: (typed: string) => void;
}) {
  const options = useMemo<ComboOption[]>(() => editions.map((e) => ({ id: e.id, label: e.archived ? `${e.label} (archived)` : e.label, detail: e.detail })), [editions]);
  const [typed, setTyped] = useState("");
  if (loadError) return <p className="text-sm text-destructive" role="alert">Could not load the events, so an event cannot be linked right now. You can link it later from the enquiry.</p>;
  return (
    <SearchCombobox
      id={id} name={name} label="Event / Exhibition (optional)" help={ENQUIRY_HELP.event} options={options} value={value} onChange={onChange}
      placeholder="Type an event name or year" onQueryChange={setTyped}
      emptyText={(q) => onCreate
        ? <>Nothing matches “{q}”. Use Create event or edition below to add it.</>
        : <>Nothing matches “{q}”. <Link href="/sales/events" className="underline underline-offset-2">Add the event or its edition</Link> in Events &amp; Exhibitions first.</>}
      // The text typed is passed on only while nothing is chosen: once an edition is chosen the field shows its label, which is not an event name.
      footer={onCreate ? <Button type="button" size="sm" variant="ghost" onClick={() => onCreate(value ? "" : typed.trim())}><Plus className="h-4 w-4" aria-hidden /> Create event or edition</Button> : undefined}
    />
  );
}

export function DuplicateWarning({ matches, onDismiss, checkFailed = false }: { matches: DuplicateMatch[]; onDismiss: (id: string) => void; checkFailed?: boolean }) {
  // A failed check is not "no duplicates": say so, and ask for a look at the existing enquiries (still a warning, never a block).
  if (checkFailed) return <Alert variant="warning" role="status">Could not check for duplicates. Look at the existing enquiries before you save this one.</Alert>;
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

// ---------------------------------------------------------------------------------------------------------------
// Pieces Quick Add and the full form share (so the company, the currency and what is about to be saved read the same in both)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The company an enquiry is recorded for. With one company it is simply stated. With several it is a choice that starts on the active Sales company; when there
 * is no reliable default it starts EMPTY and says so, and the form around it stays locked until the person chooses. It never starts on the first in the list.
 */
export function CompanyField({ id, companies, value, onChange, from }: { id: string; companies: readonly EnquiryCompany[]; value: string; onChange: (id: string) => void; from?: ActiveCompanySource }) {
  const company = companies.find((c) => c.id === value) ?? null;
  if (companies.length === 1 && company) {
    return (
      <p className="text-sm" data-testid="enquiry-company">
        <input type="hidden" name="companyId" value={company.id} />
        <span className="text-muted-foreground">{ENQUIRY_LABELS.company}</span> <span className="font-medium">{company.name}</span>
        <InfoHint label={ENQUIRY_LABELS.company} className="ml-0.5">{ACTIVE_COMPANY_WHY.only}</InfoHint>
      </p>
    );
  }
  return (
    <div className="space-y-1.5" data-testid="enquiry-company" data-choose={value ? undefined : "true"}>
      <Field label={ENQUIRY_LABELS.company} htmlFor={id} help={<>{ENQUIRY_HELP.company}{value && from && from !== "choose" && from !== "none" ? <> It starts on this one: {ACTIVE_COMPANY_WHY[from].replace(/^It is/, "it is")}</> : null}</>}>
        <Select id={id} name="companyId" value={value} onChange={(e) => onChange(e.target.value)} required aria-describedby={value ? undefined : `${id}-choose`}>
          {value ? null : <option value="" disabled>Choose a company…</option>}
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.hasSettings ? "" : " (no Sales settings yet)"}</option>)}
        </Select>
      </Field>
      {value ? null : <p id={`${id}-choose`} role="status" className="text-sm font-medium text-[hsl(var(--os-amber))]">Choose the company first. You have Sales access to more than one and none is assumed. The rest unlocks once you choose.</p>}
    </div>
  );
}

/** The blocking message for a company that has no Sales settings (no reference code or default currency), unchanged in meaning: nothing can be recorded for it. */
export function NoSettingsAlert({ company }: { company: EnquiryCompany | null }) {
  if (!company || company.hasSettings) return null;
  return (
    <Alert variant="warning">
      <strong>{company.name}</strong> has no Sales settings yet (reference code and default currency), so enquiries cannot be recorded for it.{" "}
      {company.canOpenSettings ? <Link href="/sales/settings" className="font-medium underline underline-offset-2">Set it up in Settings</Link> : "Ask a founder to set it up in Sales settings."}
    </Alert>
  );
}

/**
 * The currency of the enquiry. `chosen` is what the person typed (null = untouched): a choice is kept when the company changes, an untouched field follows the
 * company's default. The line under the field always says which of the two it is.
 */
export function CurrencyField({ id, company, chosen, onChange }: { id: string; company: EnquiryCompany | null; chosen: string | null; onChange: (chosen: string | null) => void }) {
  const state = resolveCurrency(chosen, company?.currency);
  return (
    <div className="space-y-1.5">
      <Field label={ENQUIRY_LABELS.currency} htmlFor={id} help="A 3-letter code, for example AED. An enquiry keeps the currency it is saved with.">
        <Input id={id} name="currency" list={`${id}-list`} maxLength={3} pattern="[A-Za-z]{3}" title="A 3-letter currency code, for example AED" value={chosen ?? company?.currency ?? ""}
          onChange={(e) => onChange(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" className="uppercase" aria-describedby={`${id}-note`} />
        <datalist id={`${id}-list`}>{CURRENCY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <p id={`${id}-note`} className="text-sm text-muted-foreground" data-testid="enquiry-currency-note">
        {currencyNote(state, company?.name ?? null)}
        {state.source === "chosen" && company?.currency && company.currency !== state.value ? <>{" "}<button type="button" className="font-medium underline underline-offset-2 hover:text-foreground" onClick={() => onChange(null)}>Use {company.currency} ({company.name}&apos;s default)</button></> : null}
      </p>
    </div>
  );
}

/** Company and currency together, in words, right before the save button: what is about to be saved, and where. */
export function SavingToLine({ company, currency }: { company: EnquiryCompany | null; currency: CurrencyState }) {
  return (
    <p role="status" className="text-sm" data-testid="enquiry-saving-to">
      {company ? (
        <>
          Saving to <strong className="font-semibold">{company.name}</strong>{currency.value ? <> in <strong className="font-semibold">{currency.value}</strong></> : null}.{" "}
          <span className="text-muted-foreground">{currency.source === "chosen" ? "The currency is your own choice." : currency.source === "default" ? "The currency is this company's default." : ""}</span>
        </>
      ) : <span className="font-medium text-[hsl(var(--os-amber))]">Choose a company before saving.</span>}
    </p>
  );
}

/** Cancel: back to where the person came from. `returnTo` (an address inside Sales) wins; otherwise the previous page of this tab when there is one, else the Enquiries list. */
function CancelLink({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  return (
    <Link
      href={returnTo || "/sales/opportunities"} className={cn(buttonVariants({ variant: "ghost" }))}
      onClick={(e) => {
        if (returnTo || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        let cameFromHere = false;
        try { cameFromHere = !!document.referrer && new URL(document.referrer).origin === window.location.origin && window.history.length > 1; } catch { /* no usable referrer: the link's own address is used */ }
        if (cameFromHere) { e.preventDefault(); router.back(); }
      }}
    >Cancel</Link>
  );
}

export function NewEnquiryForm({
  companies, organisations: serverOrganisations, contacts: serverContacts, currentUserId, currentUserName, today, activeCompany, prefill, prefillIgnored = [], editions: serverEditions = [], events: serverEvents = [], editionsFailed = false,
}: {
  companies: EnquiryCompany[];
  organisations: EnquiryOrganisation[];
  /** The editions an enquiry can be linked to (shared by every company) and whether they could not be loaded. */
  editions?: EditionOption[];
  /** The live events, so a missing event or edition can be added from the Event / Exhibition field. */
  events?: EventChoice[];
  editionsFailed?: boolean;
  contacts: EnquiryContact[];
  currentUserId: string;
  currentUserName: string;
  /** Today's date in Dubai (YYYY-MM-DD), decided on the server so the page does not differ between server and browser. */
  today: string;
  /** The active Sales company and why it is the one (lib/crm/active-company.ts). `from: "choose"` = no reliable default: the form starts with no company. */
  activeCompany?: { id: string | null; from: ActiveCompanySource };
  /** Starting values read from the address (parseEnquiryPrefill): from Quick Add's "Open the full form", or from an account's Outreach section. Already checked against what the person may use. */
  prefill?: EnquiryPrefill | null;
  /** The names of address parameters that were not used (an id the person may not use, a malformed value). */
  prefillIgnored?: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(createOpportunity, initialState);
  const submissionKey = useSubmissionKey();
  const [clientError, setClientError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // A second click or Enter while the first save is on its way must not send the enquiry twice. `pending` only changes with the next render, so the lock is a
  // ref set in the same tick as the first submit; it is released when the server answers (a refused save can then be corrected and sent again).
  const sending = useRef(false);
  useEffect(() => { sending.current = false; }, [state]);

  const [companyId, setCompanyId] = useState(() => startingCompanyId(companies, activeCompany));
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

  const [title, setTitle] = useState(prefill?.title ?? "");
  // An account carried over without a side was already put in the picker its role fits (parseEnquiryPrefill). The pickers stay editable.
  const [agencyId, setAgencyId] = useState(prefill?.agencyId ?? "");
  const [clientId, setClientId] = useState(prefill?.clientId ?? "");
  // An event or edition added from this page is offered (and chosen) straight away; the enquiry itself is saved only by its own button.
  const { allEditions: editions, allEvents: events, add: addEdition } = useCreatedEditions(serverEditions, serverEvents);
  const [eventDialog, setEventDialog] = useState<{ name: string } | null>(null);
  // Event start and end follow the chosen edition until the person sets them (lib/crm/events/edition-dates.ts); both stay editable.
  const dates = useEditionDates({ editions, editionId: prefill?.editionId ?? "", start: prefill?.eventStart, end: prefill?.eventEnd });
  const { editionId, start: eventStart, end: eventEnd, setStart: setEventStart, setEnd: setEventEnd, setEdition: setEditionId } = dates;
  const [checkedContacts, setCheckedContacts] = useState<Set<string>>(() => new Set(prefill?.contactIds ?? []));
  const [installStart, setInstallStart] = useState(prefill?.installStart ?? "");
  const [location, setLocation] = useState(prefill?.location ?? "");
  const [techRows, setTechRows] = useState<TechnologyRow[]>(() => [emptyTechRow()]);
  const [brief, setBrief] = useState(prefill?.brief ?? "");
  // null = the person has not touched the currency: it follows the company. A currency named in the address is the person's own choice.
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(prefill?.currency ? prefill.currency : null);
  const [ownerChoice, setOwnerChoice] = useState(prefill?.ownerId || currentUserId);

  // The longer text typed in Quick Add (a long brief, the technologies) is handed over in this browser tab, not in the address. It is read once.
  const carryToken = prefill?.carry ?? "";
  useEffect(() => {
    if (!carryToken) return;
    // Read a moment after the form is on screen (and only then removed), so a render that is thrown away and repeated cannot lose it.
    const timer = setTimeout(() => {
      let stored: string | null = null;
      try { stored = sessionStorage.getItem(CARRY_KEY); sessionStorage.removeItem(CARRY_KEY); } catch { /* storage blocked: the rest of the form is still filled from the address */ }
      const carried = readCarried(stored, carryToken);
      if (!carried) return;
      const text = carried.brief;
      if (text) setBrief((was) => was || text);
      const tech = carried.technologies;
      if (tech && tech.length > 0) setTechRows(tech.map((t) => ({ key: techKey++, name: t.name, qty: String(t.qty) })));
    }, 0);
    return () => clearTimeout(timer);
  }, [carryToken]);

  const [orgDialog, setOrgDialog] = useState<null | "agency" | "client">(null);
  const [contactDialog, setContactDialog] = useState(false);

  const currency = resolveCurrency(currencyChoice, company?.currency);
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
  const [dupFailed, setDupFailed] = useState(false);
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
        .then((found) => { if (!cancelled) { setMatches(found); setDupFailed(false); } })
        .catch(() => { if (!cancelled) { setMatches([]); setDupFailed(true); } });
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
    if (sending.current || pending) return;
    setClientError(null);
    const blockedBy = enquiryBlockedReason({ company, agencyId, clientId, techError: tech.error });
    if (blockedBy) return setClientError(blockedBy);
    const data = new FormData(e.currentTarget);
    sending.current = true;
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

  // A record added from a picker is chosen in that picker, and the keyboard focus goes back to the field it was added from (after the dialog has gone).
  const backTo = (fieldId: string) => { setTimeout(() => focusComboQuietly(fieldId), 0); };
  function addOrganisation(side: "agency" | "client", org: CreatedOrganisation) {
    setAddedOrgs((prev) => [...prev, { id: org.id, name: org.name, kind: org.kind, roles: [org.kind], place: org.place }]);
    if (side === "agency") setAgencyId(org.id); else setClientId(org.id);
    backTo(side === "agency" ? "enq-agency" : "enq-client");
  }

  const blocked = !company || !company.hasSettings;
  const carriedOver = !!prefill && hasPrefill(prefill);

  return (
    <>
      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3">
        {prefill?.outreachId ? <input type="hidden" name="outreachId" value={prefill.outreachId} /> : null}
        {/* One identifier for this opened form: saving it again (after a lost answer) returns the enquiry already saved instead of making a second one. */}
        {submissionKey ? <input type="hidden" name="submissionKey" value={submissionKey} /> : null}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {prefill?.outreachId ? (
            <Alert role="status" data-testid="enquiry-carried-over"><strong>Carried over from outreach: check before saving.</strong> The account, the company and anything else below came from the outreach. Saving links this enquiry to that outreach.</Alert>
          ) : carriedOver ? (
            <Alert role="status" data-testid="enquiry-carried-over"><strong>Carried over: check before saving.</strong> What you had already entered is filled in below. Nothing is saved yet.</Alert>
          ) : null}
          {prefillIgnored.length > 0 ? <Alert variant="warning" role="status">Part of the link could not be used and was left out ({prefillIgnored.join(", ")}): it did not match anything you can choose here. Fill those in yourself.</Alert> : null}

          {/* No section title here: the field is labelled "Company" itself (with the same explanation behind its ⓘ), and a "Company" heading above it said the word twice. */}
          <Card data-testid="enquiry-company-card">
            <CardContent className="space-y-4 pt-6">
              <CompanyField id="enq-company" companies={companies} value={companyId} onChange={setCompanyId} from={activeCompany?.from} />
              <NoSettingsAlert company={company} />
            </CardContent>
          </Card>

          {/* Until a company is chosen nothing below can be filled in: a disabled fieldset turns every field and button inside it off at once. */}
          <fieldset disabled={!company} className={cn("m-0 min-w-0 space-y-6 border-0 p-0", !company && "opacity-60")} aria-label="Enquiry details">
          <Section title="The enquiry" help="Leave anything you do not know blank further down. Everything can be edited later.">
            <Field label={ENQUIRY_LABELS.title} htmlFor="enq-title" help={ENQUIRY_HELP.title}>
              <Input id="enq-title" name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={ENQUIRY_LABELS.source} htmlFor="enq-source">
              <Select id="enq-source" name="source" required defaultValue={prefill?.source ?? ""}>
                <option value="" disabled>Choose a source…</option>
                {CRM_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>
          </Section>

          <Section title="Who is it from?" description="An enquiry needs an agency or an end client, or both." help="The agency is who sent the brief; the end client is the brand the work is for. They are recorded separately, and one organisation can be both. Contacts are optional.">
            <fieldset className="space-y-4">
              <legend className="sr-only">Agency and end client (at least one is required)</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <OrganisationPicker
                  id="enq-agency" name="agencyOrgId" label={ENQUIRY_LABELS.agency} help={ENQUIRY_HELP.agency}
                  value={agencyId} onChange={setAgencyId} organisations={organisations} field="agency" onAdd={() => setOrgDialog("agency")}
                />
                <OrganisationPicker
                  id="enq-client" name="clientOrgId" label={ENQUIRY_LABELS.client} help={ENQUIRY_HELP.client}
                  value={clientId} onChange={setClientId} organisations={organisations} field="client" onAdd={() => setOrgDialog("client")}
                />
              </div>
              {!agencyId && !clientId ? <p className="text-sm text-muted-foreground">Required: choose at least one of agency or end client.</p> : null}
              <EventEditionPicker id="enq-event" value={editionId} onChange={setEditionId} editions={editions} loadError={editionsFailed} onCreate={(name) => setEventDialog({ name })} />
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
            </fieldset>
          </Section>

          <DuplicateWarning matches={shownMatches} checkFailed={hasSignal && dupFailed} onDismiss={(id) => setDismissed((prev) => new Set(prev).add(id))} />

          <Section title="Next action and owner" description="Every enquiry needs an owner and a next step with a date." help="The next action appears in the owner's follow-ups on the date and time you set, so nothing is left waiting.">
            <Field label={ENQUIRY_LABELS.next} htmlFor="enq-next-title" help={ENQUIRY_HELP.next}>
              <Input id="enq-next-title" name="nextTitle" required maxLength={200} defaultValue={prefill?.nextTitle ?? ""} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Date" htmlFor="enq-next-date">
                <Input id="enq-next-date" name="nextDate" type="date" required min={today} defaultValue={prefill?.nextDate || today} />
              </Field>
              <Field label={DUE_TIME_LABEL} htmlFor="enq-next-time">
                <Input id="enq-next-time" name="nextTime" type="time" defaultValue={prefill?.nextTime || DEFAULT_NEXT_TIME} />
              </Field>
              <Field label="Type" htmlFor="enq-next-kind">
                <Select id="enq-next-kind" name="nextKind" defaultValue={prefill?.nextKind || DEFAULT_NEXT_KIND}>{NEXT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
              </Field>
            </div>
            {company?.canAssignOwner ? (
              <Field label={ENQUIRY_LABELS.owner} htmlFor="enq-owner" help={ENQUIRY_HELP.owner}>
                <Select id="enq-owner" name="ownerId" value={owner} onChange={(e) => setOwnerChoice(e.target.value)}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === currentUserId ? " (me)" : ""}</option>)}
                </Select>
              </Field>
            ) : (
              <p className="text-sm"><span className="font-medium">Owner:</span> you.<InfoHint label="Owner" className="ml-1">Only a founder or someone allowed to assign owners can give an enquiry to a colleague.</InfoHint></p>
            )}
          </Section>

          <Section title="Job details" description="Optional." help="Add what you know now. Everything can be edited later.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Event start" htmlFor="enq-event-start">
                <Input id="enq-event-start" name="eventStart" type="date" value={eventStart} onChange={(e) => setEventStart(e.target.value)} />
              </Field>
              <Field label="Event end" htmlFor="enq-event-end">
                <Input id="enq-event-end" name="eventEnd" type="date" min={eventStart || undefined} value={eventEnd} onChange={(e) => setEventEnd(e.target.value)} />
              </Field>
              <Field label="Installation date" htmlFor="enq-install">
                <Input id="enq-install" name="installStart" type="date" value={installStart} onChange={(e) => setInstallStart(e.target.value)} />
              </Field>
            </div>
            {dates.note}
            <Field label="Location" htmlFor="enq-location" help={ENQUIRY_HELP.location}>
              <Input id="enq-location" name="location" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} />
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

            <Field label="Waiting on" htmlFor="enq-waiting" help={ENQUIRY_HELP.waitingOn}>
              <Select id="enq-waiting" name="waitingOn" defaultValue="">
                <option value="">Nobody</option>
                <option value="client">The client</option>
                <option value="internal">Our own team</option>
              </Select>
            </Field>
            <Field label="Brief" htmlFor="enq-brief" help={ENQUIRY_HELP.brief}>
              <Textarea id="enq-brief" name="brief" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} />
            </Field>
            <Field label="Scope" htmlFor="enq-scope" help={ENQUIRY_HELP.scope}>
              <Textarea id="enq-scope" name="scope" rows={3} />
            </Field>
          </Section>

          <Section title="Budget" description="Optional." help={ENQUIRY_HELP.value}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={ENQUIRY_LABELS.value} htmlFor="enq-value">
                <Input id="enq-value" name="value" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={prefill?.value ?? ""} />
              </Field>
              <CurrencyField id="enq-currency" company={company} chosen={currencyChoice} onChange={setCurrencyChoice} />
            </div>
            <Field label="Budget note" htmlFor="enq-budget-note" help={ENQUIRY_HELP.budgetNote}>
              <Input id="enq-budget-note" name="budgetNote" defaultValue={prefill?.budgetNote ?? ""} />
            </Field>
          </Section>
          </fieldset>

          <div ref={errorRef} tabIndex={-1} className="outline-none" aria-live="polite">
            {error ? <Alert variant="destructive">{error}{state.error && !clientError && !state.existingEnquiryId ? " Nothing was saved, and what you entered is still here: correct it and save again." : ""}</Alert> : null}
            {state.existingEnquiryId && !clientError ? <p className="mt-2 text-sm"><Link href={`/sales/opportunities/${state.existingEnquiryId}`} className="font-medium underline underline-offset-2">Open the existing enquiry</Link></p> : null}
          </div>
          <SavingToLine company={company} currency={currency} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || blocked}>{pending ? "Saving…" : "Record enquiry"}</Button>
            <CancelLink returnTo={prefill?.returnTo ?? ""} />
          </div>
        </div>

        <aside aria-label="What happens next" className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">What happens next</CardTitle></CardHeader>
            <CardContent>
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                <li>It starts as a new enquiry with its own reference. Nothing is sent to the client.</li>
                <li>The owner is responsible for it. Unless you assign someone else, that is you.</li>
                <li>Your next action appears in the owner&apos;s follow-ups with the date and time you set.</li>
                <li>If a similar enquiry exists you will see a warning. You can still save.</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </form>

      <EventEditionDialog
        open={eventDialog !== null}
        onClose={() => setEventDialog(null)}
        events={events}
        initial={{ name: eventDialog?.name ?? "", start: eventStart, end: eventEnd }}
        onCreated={(c) => { addEdition(c); setEditionId(c.editionId, { id: c.editionId, start: c.start, end: c.end }); backTo("enq-event"); }}
      />
      <AddOrganisationDialog
        open={orgDialog !== null}
        onClose={() => setOrgDialog(null)}
        defaultKind={orgDialog === "agency" ? "agency" : "client"}
        onCreated={(org) => addOrganisation(orgDialog ?? "client", org)}
        onUseExisting={(org) => { if (orgDialog === "agency") { setAgencyId(org.id); backTo("enq-agency"); } else { setClientId(org.id); backTo("enq-client"); } }}
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
