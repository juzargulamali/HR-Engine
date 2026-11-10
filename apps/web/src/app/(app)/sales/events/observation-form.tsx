"use client";

import { useMemo, useState } from "react";
import { ClipboardPen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { removeObservation, saveObservation } from "@/lib/actions/events";
import { AGENCY_ROLES, AGENCY_ROLE_LABEL } from "@/lib/crm/events/model";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { SearchCombobox, type ComboOption } from "@/components/sales/combobox";

export interface OrgChoice { id: string; name: string; country: string | null; website: string | null; roles: string[]; priority: number | null }
export interface EditionChoice { id: string; label: string }
export interface ObservationValues { id: string; kind: "exhibited" | "did_not_exhibit"; agencyId: string; agencyUnknown: boolean; stand: string; role: string; note: string; confirmed: boolean; exhibitorName: string; editionLabel: string }

const detailOf = (o: OrgChoice) => [o.country ? countryLabel(o.country) : null, o.website ? o.website.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/.*$/, "") : null].filter(Boolean).join(" · ");
const hasAgencyRole = (o: OrgChoice) => o.roles.length === 0 || o.roles.includes("agency");

export function ObservationFields({ editions, orgs, initial }: { editions: EditionChoice[]; orgs: OrgChoice[]; initial: Partial<ObservationValues> & { editionId?: string } }) {
  const editing = !!initial.id;
  const [exhibitor, setExhibitor] = useState("");
  const [kind, setKind] = useState<"exhibited" | "did_not_exhibit">(initial.kind ?? "exhibited");
  const [agency, setAgency] = useState(initial.agencyId ?? "");
  const [unknown, setUnknown] = useState(initial.agencyUnknown ?? false);
  const exhibitorOptions = useMemo<ComboOption[]>(() => orgs.map((o) => ({ id: o.id, label: o.name, detail: detailOf(o) })), [orgs]);
  const agencyOptions = useMemo<ComboOption[]>(() => orgs.filter(hasAgencyRole).map((o) => ({ id: o.id, label: o.name, detail: detailOf(o) })), [orgs]);
  const exhibited = kind === "exhibited";
  return (
    <>
      {editing ? (
        <p className="text-sm"><span className="font-medium">{initial.exhibitorName}</span> at <span className="font-medium">{initial.editionLabel}</span></p>
      ) : (
        <>
          <Field label="Edition" htmlFor="ob-edition"><Select id="ob-edition" name="editionId" required defaultValue={initial.editionId ?? ""} className="min-h-11"><option value="" disabled>Choose the edition…</option>{editions.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}</Select></Field>
          <SearchCombobox id="ob-exhibitor" name="exhibitorId" label="Exhibitor / client" required options={exhibitorOptions} value={exhibitor} onChange={setExhibitor} placeholder="Type the exhibitor's name"
            emptyText={(q) => <>Nothing matches “{q}”. <Link href="/sales/accounts" className="underline underline-offset-2">Add the account in Clients &amp; Agencies</Link> first, then record it here.</>} />
        </>
      )}
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">What did you see?</legend>
        <div className="grid grid-cols-2 gap-2">
          {([["exhibited", "Exhibited"], ["did_not_exhibit", "Did not exhibit"]] as const).map(([v, l]) => (
            <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
              <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} className="h-4 w-4 accent-[hsl(var(--primary))]" /> {l}
            </label>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Leave the form alone when you saw nothing: no record means “No observation”, which is not the same as “Did not exhibit”.</p>
      </fieldset>
      {exhibited ? (
        <>
          <SearchCombobox id="ob-agency" name="agencyId" label="Agency" options={agencyOptions} value={unknown ? "" : agency} onChange={setAgency} disabled={unknown} placeholder={unknown ? "Agency unknown" : "Type the agency's name"}
            emptyText={(q) => <>Nothing recorded as an agency matches “{q}”. <Link href="/sales/accounts" className="underline underline-offset-2">Add it in Clients &amp; Agencies</Link>, or tick “Agency unknown”.</>} />
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" name="agencyUnknown" checked={unknown} onChange={(e) => { setUnknown(e.target.checked); if (e.target.checked) setAgency(""); }} className="h-4 w-4 accent-[hsl(var(--primary))]" /> Agency unknown (exhibited, but I do not know who built it)
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Stand number (optional)" htmlFor="ob-stand"><Input id="ob-stand" name="stand" maxLength={40} defaultValue={initial.stand ?? ""} autoComplete="off" className="min-h-11" /></Field>
            <Field label="Agency role (optional)" htmlFor="ob-role">
              <Select id="ob-role" name="role" defaultValue={initial.role ?? ""} className="min-h-11"><option value="">Not recorded</option>{AGENCY_ROLES.map((r) => <option key={r} value={r}>{AGENCY_ROLE_LABEL[r]}</option>)}</Select>
            </Field>
          </div>
        </>
      ) : null}
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" name="confirmed" defaultChecked={initial.confirmed ?? false} className="h-4 w-4 accent-[hsl(var(--primary))]" /> Confirmed (I saw it myself or was told directly). Leave unticked if it is unverified.
      </label>
      <Field label="Note (optional)" htmlFor="ob-note"><Textarea id="ob-note" name="note" rows={2} maxLength={1000} defaultValue={initial.note ?? ""} /></Field>
    </>
  );
}

/** "Record an observation": edition, exhibitor and agency (or Agency unknown) with an optional stand, role and note. Needs no enquiry and creates none. Built for a phone. */
export function RecordObservationButton({ editions, orgs, editionId, variant = "default" }: { editions: EditionChoice[]; orgs: OrgChoice[]; editionId?: string; variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} className="min-h-11" onClick={() => setOpen(true)}><ClipboardPen className="h-4 w-4" aria-hidden /> Record an observation</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record an observation" description="What you saw at one edition. It does not need an enquiry.">
        <ActionForm action={saveObservation} submitLabel="Save observation" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <ObservationFields editions={editions} orgs={orgs} initial={{ editionId }} />
        </ActionForm>
      </Modal>
    </>
  );
}

export function RemoveObservationButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  return (
    <span className="inline-flex flex-col items-start">
      <Button type="button" variant="ghost" size="sm" disabled={state.busy} aria-label={`Remove observation: ${label}`}
        onClick={async () => {
          if (!confirm(`Remove this observation (${label})? This cannot be undone.`)) return;
          setState({ busy: true, error: null });
          const r = await removeObservation(id);
          if (r.error) setState({ busy: false, error: r.error }); else { setState({ busy: false, error: null }); router.refresh(); }
        }}><Trash2 className="h-4 w-4" aria-hidden /></Button>
      {state.error ? <Alert variant="destructive" role="alert" className="mt-1 px-2 py-1 text-xs">{state.error}</Alert> : null}
    </span>
  );
}
