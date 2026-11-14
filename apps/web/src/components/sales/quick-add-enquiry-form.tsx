"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CRM_SOURCES, type DuplicateMatch } from "@enginious-hr/domain";
import { checkDuplicates, createOpportunity } from "@/lib/actions/crm";
import type { ActionState } from "@/lib/actions/companies";
import { formatDate } from "@/components/sales/format";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MoreDetails, QuickAdd } from "@/components/workspace/quick-add";
import { withParams } from "@/components/workspace/url-state";
import { ActionForm, Field } from "./action-form";
import { focusComboQuietly } from "./combobox";
import { AddOrganisationDialog, type CreatedOrganisation } from "@/app/(app)/sales/clients/entity-dialogs";
import {
  CompanyField, CurrencyField, DuplicateWarning, EventEditionPicker, NoSettingsAlert, OrganisationPicker, SavingToLine, type EnquiryCompany, type EnquiryOrganisation,
} from "@/app/(app)/sales/new/new-enquiry-form";
import {
  CARRY_KEY, ADDRESS_TEXT_MAX, DEFAULT_NEXT_KIND, DEFAULT_NEXT_TIME, DUE_TIME_LABEL, ENQUIRY_HELP, ENQUIRY_LABELS, enquiryBlockedReason, fullFormHandOff, resolveCurrency, startingCompanyId,
} from "@/app/(app)/sales/new/enquiry-form-shared";
import type { ActiveCompanySource } from "@/lib/crm/active-company";
import type { EditionOption } from "@/lib/crm/events/data";
import type { EventChoice } from "@/lib/crm/events/model";
import { EventEditionDialog, useCreatedEditions } from "@/components/sales/event-edition-dialog";
import { useEditionDates } from "@/components/sales/use-edition-dates";
import { parseTechnologyRows, type TechnologyRow } from "@/app/(app)/sales/new/technologies";

let techKey = 1;
const emptyTech = (): TechnologyRow => ({ key: techKey++, name: "", qty: "1" });

export interface QuickAddEnquiryProps {
  companies: EnquiryCompany[];
  organisations: EnquiryOrganisation[];
  editions?: EditionOption[];
  events?: EventChoice[];
  editionsFailed?: boolean;
  currentUserId: string;
  currentUserName: string;
  today: string;
  /** The active Sales company and why it is the one. `from: "choose"` = no reliable default: the form starts with no company and asks. */
  activeCompany: { id: string | null; from: ActiveCompanySource };
}

/**
 * The short form: which company, what the enquiry is, who it is from, where it came from and what happens next. Everything else is behind "Add more details",
 * and "Open the full form" carries over whatever has been typed. It posts to the same createOpportunity action as the full form, with the same labels, defaults
 * and checks (app/(app)/sales/new/enquiry-form-shared.ts).
 */
function QuickForm({ companies, organisations: serverOrganisations, editions: serverEditions = [], events: serverEvents = [], editionsFailed = false, currentUserId, currentUserName, today, activeCompany, close }: QuickAddEnquiryProps & { close: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  // The list this was opened from, with its filters: a save comes back here with the new enquiry open beside it, and the full form's Cancel returns here.
  const here = withParams(pathname, sp, { add: null, open: null });
  const [companyId, setCompanyId] = useState(() => startingCompanyId(companies, activeCompany));
  const company = companies.find((c) => c.id === companyId) ?? null;
  const [agencyId, setAgencyId] = useState("");
  const [clientId, setClientId] = useState("");
  // An event or edition added from this form is offered (and chosen) straight away; the enquiry itself is saved only by its own button.
  const { allEditions: editions, allEvents: events, add: addEdition } = useCreatedEditions(serverEditions, serverEvents);
  const [eventDialog, setEventDialog] = useState<{ name: string } | null>(null);
  // Event start and end follow the chosen edition until the person sets them (lib/crm/events/edition-dates.ts); both stay editable.
  const dates = useEditionDates({ editions });
  const { editionId, start: eventStart, end: eventEnd, setStart: setEventStart, setEnd: setEventEnd, setEdition: setEditionId } = dates;
  const [title, setTitle] = useState("");
  const [installStart, setInstallStart] = useState("");
  const [location, setLocation] = useState("");
  const [techRows, setTechRows] = useState<TechnologyRow[]>(() => [emptyTech()]);
  const [owner, setOwner] = useState(currentUserId);
  // null = the currency has not been touched: it follows the chosen company's default. A code the person typed stays when the company changes.
  const [currencyChoice, setCurrencyChoice] = useState<string | null>(null);
  const currency = resolveCurrency(currencyChoice, company?.currency);
  const [addedOrgs, setAddedOrgs] = useState<EnquiryOrganisation[]>([]);
  const [orgDialog, setOrgDialog] = useState<null | "agency" | "client">(null);

  const organisations = useMemo(() => {
    const known = new Set(serverOrganisations.map((o) => o.id));
    return [...serverOrganisations, ...addedOrgs.filter((o) => !known.has(o.id))].sort((a, b) => a.name.localeCompare(b.name));
  }, [serverOrganisations, addedOrgs]);
  const people = useMemo(() => {
    const list = company?.people ?? [];
    return list.some((p) => p.id === currentUserId) ? list : [{ id: currentUserId, name: currentUserName }, ...list];
  }, [company, currentUserId, currentUserName]);
  const ownerValue = people.some((p) => p.id === owner) ? owner : currentUserId;
  const tech = useMemo(() => parseTechnologyRows(techRows), [techRows]);

  // The same duplicate warning as the full form (a warning, never a block).
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [dupFailed, setDupFailed] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const hasSignal = !!agencyId || !!clientId || !!eventStart || !!installStart || location.trim() !== "";
  useEffect(() => {
    if (!hasSignal) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkDuplicates({ agencyOrgId: agencyId || null, clientOrgId: clientId || null, title, eventStart: eventStart || null, installStart: installStart || null, location: location.trim() || null, technologies: tech.items.filter((t) => t.qty >= 1) })
        .then((found) => { if (!cancelled) { setMatches(found); setDupFailed(false); } })
        .catch(() => { if (!cancelled) { setMatches([]); setDupFailed(true); } });
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [hasSignal, agencyId, clientId, title, eventStart, installStart, location, tech.items]);
  const shown = (hasSignal ? matches : []).filter((m) => !dismissed.has(m.candidate.id));

  // The same checks, in the same words, as the full form, answered before anything is sent. The server and the database check again.
  const save = async (prev: ActionState, formData: FormData): Promise<ActionState> => {
    const blockedBy = enquiryBlockedReason({ company, agencyId, clientId, techError: tech.error });
    return blockedBy ? { error: blockedBy } : createOpportunity(prev, formData);
  };

  // "Open the full form" keeps everything typed here. Short values travel in the address; a long brief and the technologies wait in this browser tab.
  const openFullForm = (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = e.currentTarget.form;
    if (!form) return;
    const data = new FormData(form);
    const get = (k: string) => String(data.get(k) ?? "");
    const token = Math.random().toString(36).slice(2, 12).padEnd(6, "0");
    const handOff = fullFormHandOff({
      companyId, title: get("title"), agencyOrgId: agencyId, clientOrgId: clientId, eventEditionId: editionId, source: get("source"), nextTitle: get("nextTitle"), nextDate: get("nextDate"),
      nextTime: get("nextTime"), nextKind: get("nextKind"), brief: get("brief"), value: get("value"), currency: currency.source === "chosen" ? currency.value : "", ownerId: get("ownerId"),
      location, eventStart, eventEnd, installStart, budgetNote: get("budgetNote"), technologies: get("technologies"),
    }, { returnTo: here, currentUserId, token });
    let href = handOff.href;
    if (handOff.carried) {
      try { sessionStorage.setItem(CARRY_KEY, JSON.stringify(handOff.carried)); }
      catch {
        // Storage is blocked: carry what fits in the address instead (the start of the brief), rather than nothing.
        const u = new URL(href, window.location.origin);
        u.searchParams.delete("carry");
        if (handOff.carried.brief) u.searchParams.set("brief", handOff.carried.brief.slice(0, ADDRESS_TEXT_MAX));
        href = `${u.pathname}${u.search}`;
      }
    }
    router.push(href);
  };

  // A record added from a picker is chosen in that picker, and the keyboard focus goes back to the field it was added from (after the dialog has gone).
  const backTo = (fieldId: string) => { setTimeout(() => focusComboQuietly(fieldId), 0); };
  const chooseOrg = (side: "agency" | "client" | null, id: string) => { if (side === "agency") { setAgencyId(id); backTo("qa-agency"); } else { setClientId(id); backTo("qa-client"); } };

  return (
    <>
      <ActionForm action={save} submitLabel="Add enquiry" pendingLabel="Adding…" onDone={close} disabled={!company || !company.hasSettings}
        secondary={<button type="button" onClick={openFullForm} className="mr-auto rounded-md text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Opens the full form with everything you have typed here">Open the full form</button>}>
        <input type="hidden" name="after" value="panel" />
        <input type="hidden" name="returnTo" value={here} />
        <input type="hidden" name="nextKind" value={DEFAULT_NEXT_KIND} />
        <CompanyField id="qa-company" companies={companies} value={companyId} onChange={setCompanyId} from={activeCompany.from} />
        <NoSettingsAlert company={company} />

        {/* Until a company is chosen nothing below can be filled in: a disabled fieldset turns every field and button inside it off at once. */}
        <fieldset disabled={!company} className={`m-0 min-w-0 space-y-4 border-0 p-0 ${company ? "" : "opacity-60"}`} aria-label="Enquiry details">
          <Field label={ENQUIRY_LABELS.title} htmlFor="qa-title" help={ENQUIRY_HELP.title}>
            <Input id="qa-title" name="title" required maxLength={200} autoFocus={!!company} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. LED tunnel for a mall activation" />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Who is it from? <span className="font-normal text-muted-foreground">One of agency or end client is required.</span></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <OrganisationPicker id="qa-agency" name="agencyOrgId" label={ENQUIRY_LABELS.agency} help={ENQUIRY_HELP.agency} value={agencyId} onChange={setAgencyId} organisations={organisations} field="agency" onAdd={() => setOrgDialog("agency")} />
              <OrganisationPicker id="qa-client" name="clientOrgId" label={ENQUIRY_LABELS.client} help={ENQUIRY_HELP.client} value={clientId} onChange={setClientId} organisations={organisations} field="client" onAdd={() => setOrgDialog("client")} />
            </div>
            <EventEditionPicker id="qa-event" value={editionId} onChange={setEditionId} editions={editions} loadError={editionsFailed} onCreate={(name) => setEventDialog({ name })} />
            {editionId && (eventStart || eventEnd) ? <p className="text-sm text-muted-foreground" role="status">Event dates on this enquiry: {eventStart ? formatDate(eventStart) : "start not set"} to {eventEnd ? formatDate(eventEnd) : "end not set"}. Change them under Add more details.</p> : null}
          </fieldset>

          <Field label={ENQUIRY_LABELS.source} htmlFor="qa-source">
            <Select id="qa-source" name="source" required defaultValue="">
              <option value="" disabled>Choose a source…</option>
              {CRM_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_8rem]">
            <Field label={ENQUIRY_LABELS.next} htmlFor="qa-next" help={ENQUIRY_HELP.next}>
              <Input id="qa-next" name="nextTitle" required maxLength={200} placeholder="e.g. Call to qualify the brief" />
            </Field>
            <Field label="Due" htmlFor="qa-due">
              <Input id="qa-due" name="nextDate" type="date" required min={today} defaultValue={today} />
            </Field>
            <Field label={DUE_TIME_LABEL} htmlFor="qa-time">
              <Input id="qa-time" name="nextTime" type="time" defaultValue={DEFAULT_NEXT_TIME} />
            </Field>
          </div>

          <DuplicateWarning matches={shown} checkFailed={hasSignal && dupFailed} onDismiss={(id) => setDismissed((prev) => new Set(prev).add(id))} />

          <MoreDetails>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Event start" htmlFor="qa-es"><Input id="qa-es" name="eventStart" type="date" value={eventStart} onChange={(e) => setEventStart(e.target.value)} /></Field>
              <Field label="Event end" htmlFor="qa-ee"><Input id="qa-ee" name="eventEnd" type="date" min={eventStart || undefined} value={eventEnd} onChange={(e) => setEventEnd(e.target.value)} /></Field>
              <Field label="Installation date" htmlFor="qa-is"><Input id="qa-is" name="installStart" type="date" value={installStart} onChange={(e) => setInstallStart(e.target.value)} /></Field>
            </div>
            {dates.note}
            <Field label="Location" htmlFor="qa-loc" help={ENQUIRY_HELP.location}><Input id="qa-loc" name="location" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Technologies requested</legend>
              <input type="hidden" name="technologies" value={JSON.stringify(tech.items)} />
              <ul className="space-y-2">
                {techRows.map((row, i) => (
                  <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-2">
                    <Input aria-label={`Technology ${i + 1}`} placeholder="e.g. LED wall" value={row.name} onChange={(e) => setTechRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))} />
                    <Input aria-label={`Quantity of technology ${i + 1}`} type="number" min={1} step={1} value={row.qty} onChange={(e) => setTechRows((rows) => rows.map((r) => (r.key === row.key ? { ...r, qty: e.target.value } : r)))} />
                    <button type="button" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Remove technology ${i + 1}`} onClick={() => setTechRows((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== row.key) : [emptyTech()]))}>Remove</button>
                  </li>
                ))}
              </ul>
              {tech.error ? <p role="alert" className="text-sm text-destructive">{tech.error}</p> : null}
              <button type="button" className="rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setTechRows((rows) => [...rows, emptyTech()])}>Add technology</button>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={ENQUIRY_LABELS.value} htmlFor="qa-value" help={ENQUIRY_HELP.value}><Input id="qa-value" name="value" type="number" inputMode="decimal" min={0} step="0.01" /></Field>
              <CurrencyField id="qa-cur" company={company} chosen={currencyChoice} onChange={setCurrencyChoice} />
            </div>
            <Field label="Budget note" htmlFor="qa-bn" help={ENQUIRY_HELP.budgetNote}><Input id="qa-bn" name="budgetNote" /></Field>
            <Field label="Brief" htmlFor="qa-brief" help={ENQUIRY_HELP.brief}><Textarea id="qa-brief" name="brief" rows={3} /></Field>
            {company?.canAssignOwner ? (
              <Field label={ENQUIRY_LABELS.owner} htmlFor="qa-owner" help={ENQUIRY_HELP.owner}>
                <Select id="qa-owner" name="ownerId" value={ownerValue} onChange={(e) => setOwner(e.target.value)}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === currentUserId ? " (me)" : ""}</option>)}
                </Select>
              </Field>
            ) : <p className="text-sm"><span className="font-medium">Owner:</span> you.<InfoHint label="Owner" className="ml-1">Only a founder or someone allowed to assign owners can give an enquiry to a colleague.</InfoHint></p>}
            <p className="text-sm text-muted-foreground">Contacts, scope and who it is waiting on are in the full form, or on the enquiry once it is saved.</p>
          </MoreDetails>
        </fieldset>
        <SavingToLine company={company} currency={currency} />
      </ActionForm>
      <EventEditionDialog
        open={eventDialog !== null}
        onClose={() => setEventDialog(null)}
        events={events}
        initial={{ name: eventDialog?.name ?? "", start: eventStart, end: eventEnd }}
        onCreated={(c) => { addEdition(c); setEditionId(c.editionId, { id: c.editionId, start: c.start, end: c.end }); backTo("qa-event"); }}
      />
      <AddOrganisationDialog
        open={orgDialog !== null}
        onClose={() => setOrgDialog(null)}
        defaultKind={orgDialog === "agency" ? "agency" : "client"}
        onCreated={(org: CreatedOrganisation) => { setAddedOrgs((prev) => [...prev, { id: org.id, name: org.name, kind: org.kind, roles: [org.kind], place: org.place }]); chooseOrg(orgDialog, org.id); }}
        onUseExisting={(org) => chooseOrg(orgDialog, org.id)}
      />
    </>
  );
}

export function QuickAddEnquiryForm(props: QuickAddEnquiryProps) {
  return (
    <QuickAdd label="Add enquiry" title="Add an enquiry" description="Record it the moment it arrives. Everything else can be added later." help="Saving records the enquiry in Sales with its owner and next action. Nothing is sent to the client. Open the full form keeps everything you have typed here." size="wide">
      {({ close }) => <QuickForm {...props} close={close} />}
    </QuickAdd>
  );
}
