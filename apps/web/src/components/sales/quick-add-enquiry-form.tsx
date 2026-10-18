"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CRM_SOURCES, type DuplicateMatch } from "@enginious-hr/domain";
import { checkDuplicates, createOpportunity } from "@/lib/actions/crm";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MoreDetails, QuickAdd } from "@/components/workspace/quick-add";
import { ActionForm, Field } from "./action-form";
import { AddOrganisationDialog, type CreatedOrganisation } from "@/app/(app)/sales/clients/entity-dialogs";
import { DuplicateWarning, OrganisationPicker, type EnquiryCompany, type EnquiryOrganisation } from "@/app/(app)/sales/new/new-enquiry-form";
import { parseTechnologyRows, type TechnologyRow } from "@/app/(app)/sales/new/technologies";

let techKey = 1;
const emptyTech = (): TechnologyRow => ({ key: techKey++, name: "", qty: "1" });

/** The short form: what the enquiry is, who it is from, where it came from and what happens next. Everything else is behind "Add more details". */
function QuickForm({ companies, organisations: serverOrganisations, currentUserId, currentUserName, today, close }: { companies: EnquiryCompany[]; organisations: EnquiryOrganisation[]; currentUserId: string; currentUserName: string; today: string; close: () => void }) {
  const [companyId, setCompanyId] = useState((companies.find((c) => c.hasSettings) ?? companies[0])?.id ?? "");
  const company = companies.find((c) => c.id === companyId) ?? null;
  const [agencyId, setAgencyId] = useState("");
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [installStart, setInstallStart] = useState("");
  const [location, setLocation] = useState("");
  const [techRows, setTechRows] = useState<TechnologyRow[]>(() => [emptyTech()]);
  const [owner, setOwner] = useState(currentUserId);
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
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const hasSignal = !!agencyId || !!clientId || !!eventStart || !!installStart || location.trim() !== "";
  useEffect(() => {
    if (!hasSignal) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      checkDuplicates({ agencyOrgId: agencyId || null, clientOrgId: clientId || null, title, eventStart: eventStart || null, installStart: installStart || null, location: location.trim() || null, technologies: tech.items.filter((t) => t.qty >= 1) })
        .then((found) => { if (!cancelled) setMatches(found); })
        .catch(() => { if (!cancelled) setMatches([]); });
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [hasSignal, agencyId, clientId, title, eventStart, installStart, location, tech.items]);
  const shown = (hasSignal ? matches : []).filter((m) => !dismissed.has(m.candidate.id));

  return (
    <>
      <ActionForm action={createOpportunity} submitLabel="Add enquiry" pendingLabel="Adding…" onDone={close} secondary={<Link href="/sales/new" className="mr-auto text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Open the full form</Link>}>
        <input type="hidden" name="after" value="panel" />
        <input type="hidden" name="nextTime" value="10:00" />
        <input type="hidden" name="nextKind" value="call" />
        {companies.length > 1 ? (
          <Field label="Company" htmlFor="qa-company">
            <Select id="qa-company" name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.hasSettings ? "" : " (no Sales settings yet)"}</option>)}
            </Select>
          </Field>
        ) : <input type="hidden" name="companyId" value={companyId} />}
        {company && !company.hasSettings ? <Alert variant="warning">{company.name} has no Sales settings yet, so an enquiry cannot be recorded for it. {company.canOpenSettings ? <Link href="/sales/settings" className="font-medium underline underline-offset-2">Set it up in Settings</Link> : "Ask a founder to set it up."}</Alert> : null}

        <Field label="What is the enquiry?" htmlFor="qa-title">
          <Input id="qa-title" name="title" required maxLength={200} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. LED tunnel for a mall activation" />
        </Field>

        <fieldset className="space-y-2">
          <legend className="sr-only">Who is it from? One is enough.</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <OrganisationPicker id="qa-agency" name="agencyOrgId" label="Agency" hint="One of agency or end client is enough." value={agencyId} onChange={setAgencyId} organisations={organisations} preferredKinds={["agency"]} onAdd={() => setOrgDialog("agency")} />
            <OrganisationPicker id="qa-client" name="clientOrgId" label="End client" hint="The brand the work is for." value={clientId} onChange={setClientId} organisations={organisations} preferredKinds={["client", "direct"]} onAdd={() => setOrgDialog("client")} />
          </div>
        </fieldset>

        <Field label="Where did it come from?" htmlFor="qa-source">
          <Select id="qa-source" name="source" required defaultValue="">
            <option value="" disabled>Choose a source…</option>
            {CRM_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label="Next action" htmlFor="qa-next">
            <Input id="qa-next" name="nextTitle" required placeholder="e.g. Call to qualify the brief" />
          </Field>
          <Field label="Due" htmlFor="qa-due">
            <Input id="qa-due" name="nextDate" type="date" required min={today} defaultValue={today} />
          </Field>
        </div>

        <DuplicateWarning matches={shown} onDismiss={(id) => setDismissed((prev) => new Set(prev).add(id))} />

        <MoreDetails>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Event start" htmlFor="qa-es"><Input id="qa-es" name="eventStart" type="date" value={eventStart} onChange={(e) => setEventStart(e.target.value)} /></Field>
            <Field label="Event end" htmlFor="qa-ee"><Input id="qa-ee" name="eventEnd" type="date" min={eventStart || undefined} /></Field>
            <Field label="Installation" htmlFor="qa-is"><Input id="qa-is" name="installStart" type="date" value={installStart} onChange={(e) => setInstallStart(e.target.value)} /></Field>
          </div>
          <Field label="Location" htmlFor="qa-loc"><Input id="qa-loc" name="location" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
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
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Budget or value" htmlFor="qa-value"><Input id="qa-value" name="value" type="number" inputMode="decimal" min={0} step="0.01" /></Field>
            <Field label="Currency" htmlFor="qa-cur"><Input key={companyId} id="qa-cur" name="currency" maxLength={3} pattern="[A-Za-z]{3}" title="A 3-letter currency code, for example AED" defaultValue={company?.currency ?? ""} className="uppercase" /></Field>
            <Field label="Budget note" htmlFor="qa-bn"><Input id="qa-bn" name="budgetNote" /></Field>
          </div>
          <Field label="Brief" htmlFor="qa-brief"><Textarea id="qa-brief" name="brief" rows={3} /></Field>
          {company?.canAssignOwner ? (
            <Field label="Owner" htmlFor="qa-owner" hint="You can give the enquiry to a colleague with Sales access to this company.">
              <Select id="qa-owner" name="ownerId" value={ownerValue} onChange={(e) => setOwner(e.target.value)}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === currentUserId ? " (me)" : ""}</option>)}
              </Select>
            </Field>
          ) : <p className="text-sm text-muted-foreground">Owner: you. Only a founder or someone allowed to assign owners can give an enquiry to a colleague.</p>}
        </MoreDetails>
      </ActionForm>
      <AddOrganisationDialog
        open={orgDialog !== null}
        onClose={() => setOrgDialog(null)}
        defaultKind={orgDialog === "agency" ? "agency" : "client"}
        onCreated={(org: CreatedOrganisation) => { setAddedOrgs((prev) => [...prev, { id: org.id, name: org.name, kind: org.kind, place: org.place }]); if (orgDialog === "agency") setAgencyId(org.id); else setClientId(org.id); }}
        onUseExisting={(org) => { if (orgDialog === "agency") setAgencyId(org.id); else setClientId(org.id); }}
      />
    </>
  );
}

export function QuickAddEnquiryForm(props: { companies: EnquiryCompany[]; organisations: EnquiryOrganisation[]; currentUserId: string; currentUserName: string; today: string }) {
  return (
    <QuickAdd label="Add enquiry" title="Add an enquiry" description="Record it the moment it arrives. Everything else can be added later." size="wide">
      {({ close }) => <QuickForm {...props} close={close} />}
    </QuickAdd>
  );
}
