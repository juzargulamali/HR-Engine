"use client";

import { useRef, useState } from "react";
import { saveAndSubmitHandover, saveHandover, withdrawHandover } from "@/lib/actions/projectsCore";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";
import { RESUBMIT_TELLS, SUBMIT_TELLS, WITHDRAW_CONSEQUENCE } from "./readiness";

export interface BriefValues {
  title: string;
  clientName: string;
  location: string;
  siteTimezone: string;
  /** Why this zone was suggested (a new brief only); empty for a saved brief, which keeps the zone it was saved with. */
  siteTimezoneNote?: string;
  installStart: string;
  eventStart: string;
  eventEnd: string;
  scope: string;
  exclusions: string;
  notes: string;
  technologies: { name: string; qty: number }[];
  /** Unresolved risks, one per line when edited. Carried over from the enquiry on a new brief. */
  risks?: string[];
  /** The contact chosen as the site contact (one of the enquiry's contacts), or "" for none. */
  siteContactId?: string;
}

/** One of the enquiry's linked contacts, offered as the site contact. */
export interface ContactChoice { id: string; name: string; roleTitle: string | null; organisation: string | null }

interface Row { key: number; name: string; qty: string }

function Technologies({ initial }: { initial: { name: string; qty: number }[] }) {
  const next = useRef(initial.length);
  const [rows, setRows] = useState<Row[]>(initial.map((t, i) => ({ key: i, name: t.name, qty: String(t.qty) })));
  const json = JSON.stringify(rows.filter((r) => r.name.trim() !== "").map((r) => ({ name: r.name.trim(), qty: Number(r.qty) })));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Technologies and quantities</legend>
      <input type="hidden" name="technologies" value={json} />
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">None listed.</p> : null}
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`ph-tech-name-${r.key}`} className="sr-only">Technology {i + 1}</label>
            <Input id={`ph-tech-name-${r.key}`} value={r.name} placeholder="e.g. LED wall 3 m" onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))} />
          </div>
          <div className="w-20">
            <label htmlFor={`ph-tech-qty-${r.key}`} className="sr-only">Quantity of technology {i + 1}</label>
            <Input id={`ph-tech-qty-${r.key}`} type="number" min={1} step={1} value={r.qty} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))} />
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label={`Remove technology ${i + 1}`}>Remove</Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => { const key = next.current++; setRows([...rows, { key, name: "", qty: "1" }]); }}>Add technology</Button>
    </fieldset>
  );
}

/**
 * The delivery brief. Everything written here is visible to the project's members: it must not hold prices, budgets, margins, payment terms or
 * purchase-order details. `submitMode` says what the main button does: "submit" saves and submits in one step (a first brief), "resubmit" saves and sends
 * it back to the Project Manager after a question; with neither (already submitted, or the Project Manager has it) it only saves, as before. "Save draft"
 * is always there beside it and never submits.
 */
export function ProjectHandoverForm({ opportunityId, version, values, existing, submitMode = null, contacts = null, agencyName, contactsFailed = false }: {
  opportunityId: string; version: number | null; values: BriefValues; existing: boolean; submitMode?: "submit" | "resubmit" | null;
  /** The enquiry's contacts to choose the site contact from. null = no choice is offered (the database does not record one yet, or they could not be read): nothing is sent, so the saved choice stays. */
  contacts?: readonly ContactChoice[] | null;
  /** The enquiry's agency (null = a direct job). Left out (undefined) on a database that does not record it: the line is then not shown. */
  agencyName?: string | null;
  /** True when a choice should have been offered but the contacts or the saved choice could not be read. */
  contactsFailed?: boolean;
}) {
  const combined = submitMode !== null;
  return (
    <ActionForm
      action={combined ? saveAndSubmitHandover : saveHandover}
      submitLabel={combined ? (submitMode === "resubmit" ? "Save and resubmit to the Project Manager" : "Save and submit") : existing ? "Save changes" : "Save the delivery brief"}
      pendingLabel={combined ? "Submitting…" : "Saving…"}
      secondary={combined ? <Button type="submit" name="intent" value="draft" variant="outline">Save draft</Button> : undefined}>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="expectedVersion" value={version ?? ""} />
      <Alert variant="warning" role="note">
        <strong>Everything on this form is visible to the project&apos;s members</strong> (the Project Manager, department heads and the delivery team). Do not write prices, budgets, margins, payment terms or purchase-order details here: they stay in Sales &amp; CRM.
      </Alert>
      {/* The fields follow the order of the read-only brief the Project Manager sees (scope, site and dates, equipment, risks, notes), so both sides read the same thing in the same order. */}
      <Field label="Project name" htmlFor="ph-title"><Input id="ph-title" name="title" defaultValue={values.title} required maxLength={200} /></Field>
      <Field label="Scope of work" htmlFor="ph-scope" hint="Required before you can submit." help="What was agreed to deliver. Once the Project Manager accepts, this is kept as the agreed scope.">
        <Textarea id="ph-scope" name="scope" rows={5} defaultValue={values.scope} />
      </Field>
      <Field label="Exclusions" htmlFor="ph-excl"><Textarea id="ph-excl" name="exclusions" rows={3} defaultValue={values.exclusions} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client" htmlFor="ph-client" hint={existing ? undefined : "Leave blank to use the client or agency name from the opportunity."}><Input id="ph-client" name="clientName" defaultValue={values.clientName} /></Field>
        {agencyName !== undefined ? (
          <div className="sm:col-span-2" data-testid="handover-agency">
            <p className="text-sm font-medium">Agency</p>
            <p className="mt-1 text-sm">{agencyName ?? "None: a direct job"}</p>
            <p className="mt-1 text-sm text-muted-foreground">Taken from the enquiry when you save and again when you submit. If it is wrong, correct the agency on the enquiry first: it is not typed here.</p>
          </div>
        ) : null}
        <Field label="Location" htmlFor="ph-location"><Input id="ph-location" name="location" defaultValue={values.location} /></Field>
        <Field label="Installation starts" htmlFor="ph-install"><Input id="ph-install" name="installStart" type="date" defaultValue={values.installStart} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Show starts" htmlFor="ph-estart"><Input id="ph-estart" name="eventStart" type="date" defaultValue={values.eventStart} /></Field>
          <Field label="Show ends" htmlFor="ph-eend"><Input id="ph-eend" name="eventEnd" type="date" defaultValue={values.eventEnd} /></Field>
        </div>
        <Field label="Site time zone" htmlFor="ph-tz" hint={values.siteTimezoneNote ? `Suggested because ${values.siteTimezoneNote}. Change it if the site is elsewhere. Installation and show bookings are written in this zone.` : "Installation and show bookings are written in this zone. Change it if the site is elsewhere."}>
          <Select id="ph-tz" name="siteTimezone" defaultValue={values.siteTimezone}>
            {[...new Set([values.siteTimezone, ...COMMON_TIME_ZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        </Field>
      </div>
      <Technologies initial={values.technologies} />
      <Field label="Risks" htmlFor="ph-risks" hint="One per line." help="Carried over from the enquiry. The Project Manager sees what you leave here.">
        <Textarea id="ph-risks" name="risks" rows={3} defaultValue={(values.risks ?? []).filter((r): r is string => typeof r === "string").join("\n")} />
      </Field>
      {contacts ? (
        <Field label="Site contact" htmlFor="ph-contact" hint={contacts.length === 0 ? "This enquiry has no contacts linked. Add the person under Contacts on the enquiry, then choose them here." : "Optional. One of this enquiry's contacts: the person the Project Manager calls on site."}
          help="Their name, role, phone and e-mail are copied onto the brief when you submit, and shown on the project to the Project Manager and Operations. A later change to the contact in Sales does not change an accepted project.">
          <Select id="ph-contact" name="siteContactId" defaultValue={contacts.some((c) => c.id === values.siteContactId) ? values.siteContactId : ""}>
            <option value="">No site contact</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{[c.name, c.roleTitle, c.organisation].filter(Boolean).join(" · ")}</option>)}
          </Select>
        </Field>
      ) : contactsFailed ? (
        <p role="alert" className="text-sm text-destructive" data-testid="handover-contact-unavailable">Could not load the contacts to choose a site contact from. The saved choice is left as it is; reload to change it.</p>
      ) : null}
      <Field label="Notes for the Project Manager" htmlFor="ph-notes" hint={contacts ? "Site access, client preferences, open questions." : "Site access, the site contact, client preferences, open questions."}>
        <Textarea id="ph-notes" name="notes" rows={3} defaultValue={values.notes} />
      </Field>
      {/* The consequence of the main button stays visible: who is told, and that a refused submission still keeps the draft. */}
      {combined ? <p className="text-sm text-muted-foreground" data-testid="handover-submit-tells"><span className="font-medium text-foreground">{submitMode === "resubmit" ? "When you resubmit: " : "When you submit: "}</span>{submitMode === "resubmit" ? RESUBMIT_TELLS : SUBMIT_TELLS} {submitMode === "resubmit" ? "" : "You can keep editing until the Project Manager has it. "}If something required is missing, your changes are still saved as a draft.</p> : null}
    </ActionForm>
  );
}

/** Withdrawing is the secondary action: a quiet link first, then the reason, with what it does said before the button (it cannot be undone, only prepared again). */
export function WithdrawProjectHandoverForm({ handoverId, opportunityId }: { handoverId: string; opportunityId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">Withdraw this handover</button>;
  return (
    <ActionForm action={withdrawHandover} submitLabel="Withdraw handover" pendingLabel="Withdrawing…" variant="destructive" secondary={<button type="button" onClick={() => setOpen(false)} className="text-sm underline underline-offset-2">Keep it</button>}>
      <input type="hidden" name="handoverId" value={handoverId} />
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <Alert variant="warning" role="note" data-testid="handover-withdraw-consequence">{WITHDRAW_CONSEQUENCE}</Alert>
      <Field label="Why is it being withdrawn" htmlFor="ph-withdraw"><Input id="ph-withdraw" name="reason" required placeholder="e.g. Client postponed the project" /></Field>
    </ActionForm>
  );
}
