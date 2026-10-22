"use client";

import { useMemo, useState } from "react";
import { INV_CAPABILITY_LABELS, type InvCapability } from "@enginious-hr/domain";
import {
  grantInventoryAccess, revokeInventoryAccess, setInventoryCompanySharing,
} from "@/lib/actions/inventorySetup";
import { canChangeGrant, operatorNeedsLocations, wouldRemoveLastFounder } from "@/lib/inventory/setup";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ActionForm, Field } from "@/components/sales/action-form";
import { formatDate } from "@/components/sales/format";
import { Modal } from "@/components/ui/modal";
import { CapabilityCheckboxes } from "./capability-checkboxes";

export interface AccessPersonRow {
  userId: string;
  name: string;
  email: string | null;
  capabilities: InvCapability[];
  grantedAt: string;
  grantedByName: string | null;
  note: string | null;
  /** Locations this person works at (warehouse operators). */
  locationIds: string[];
}
export interface AccessLocation { id: string; name: string; isActive: boolean }
export interface StaffOption { id: string; name: string; email: string | null }
export interface SharingRow { id: string; otherCompanyId: string; otherCompanyName: string; note: string | null; since: string }

/** Where the person works, in words. */
export function worksAtWords(p: Pick<AccessPersonRow, "capabilities" | "locationIds">, locations: readonly AccessLocation[]): string {
  if (p.capabilities.includes("founder")) return "All locations (founder)";
  if (p.capabilities.includes("cross_location")) return "All locations";
  if (!p.capabilities.includes("warehouse")) return "—";
  const names = p.locationIds.map((id) => locations.find((l) => l.id === id)?.name).filter(Boolean) as string[];
  return names.length > 0 ? names.join(", ") : "No location yet (cannot operate stock)";
}

function LocationChecklist({ locations, defaultIds, idPrefix }: { locations: readonly AccessLocation[]; defaultIds: readonly string[]; idPrefix: string }) {
  const active = locations.filter((l) => l.isActive || defaultIds.includes(l.id));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Locations this person works at</legend>
      <p className="text-sm text-muted-foreground">A warehouse operator can receive, issue, return, transfer and count only at the locations ticked here. To cover every location, including ones added later, tick &ldquo;{INV_CAPABILITY_LABELS.cross_location.label}&rdquo; above instead.</p>
      {active.length === 0 ? <p className="text-sm text-muted-foreground">No locations have been set up for this company yet. A founder adds them under Setup.</p> : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {active.map((l) => (
            <li key={l.id}>
              <label className="flex items-center gap-2 text-sm" htmlFor={`${idPrefix}-${l.id}`}>
                <input id={`${idPrefix}-${l.id}`} type="checkbox" name="locationIds" value={l.id} defaultChecked={defaultIds.includes(l.id)} className="h-4 w-4" />
                {l.name}{l.isActive ? "" : " (switched off)"}
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** Capabilities plus, for people who work in the warehouse, their locations. */
function RightsFields({ idPrefix, viewerIsFounder, defaults, locations, defaultLocationIds, lockFounder, onCaps }: {
  idPrefix: string; viewerIsFounder: boolean; defaults: readonly InvCapability[]; locations: readonly AccessLocation[]; defaultLocationIds: readonly string[];
  lockFounder?: boolean; onCaps?: (caps: ReadonlySet<InvCapability>) => void;
}) {
  const [caps, setCaps] = useState<ReadonlySet<InvCapability>>(new Set(defaults));
  const showLocations = caps.has("warehouse") && !caps.has("cross_location") && !caps.has("founder");
  return (
    <>
      <CapabilityCheckboxes idPrefix={idPrefix} viewerIsFounder={viewerIsFounder} defaultSelected={defaults} lockFounder={lockFounder} onChange={(c) => { setCaps(c); onCaps?.(c); }} />
      {showLocations ? (
        <>
          <input type="hidden" name="withLocations" value="1" />
          <LocationChecklist locations={locations} defaultIds={defaultLocationIds} idPrefix={`${idPrefix}-loc`} />
          {operatorNeedsLocations([...caps], []) ? <p className="text-sm text-muted-foreground">With no location ticked, this person has the warehouse right but cannot operate stock anywhere yet.</p> : null}
        </>
      ) : null}
    </>
  );
}

function PersonPicker({ staff }: { staff: readonly StaffOption[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? staff.filter((s) => s.name.toLowerCase().includes(t) || (s.email ?? "").toLowerCase().includes(t)) : staff;
  }, [q, staff]);
  return (
    <div className="space-y-2">
      <Field label="Find a colleague" htmlFor="inv-grant-find"><Input id="inv-grant-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing a name" autoComplete="off" /></Field>
      <Field label="Person" htmlFor="inv-grant-user" hint="Active staff only. Access is never given automatically to anyone.">
        <Select id="inv-grant-user" name="userId" required defaultValue="" key={shown.map((s) => s.id).join(",")}>
          <option value="" disabled>{shown.length === 0 ? "No one matches" : "Choose a person…"}</option>
          {shown.map((s) => <option key={s.id} value={s.id}>{s.name}{s.email ? ` (${s.email})` : ""}</option>)}
        </Select>
      </Field>
    </div>
  );
}

export function GiveAccessForm({ companyId, viewerIsFounder, staff, locations }: { companyId: string; viewerIsFounder: boolean; staff: readonly StaffOption[]; locations: readonly AccessLocation[] }) {
  // After a successful save the form starts again empty (a new key), and says so; the new person appears in the list above.
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState(false);
  return (
    <div onChange={() => setSaved(false)} className="space-y-3">
      {saved ? <Alert variant="success" role="status">Access saved. The person now appears in the list above.</Alert> : null}
      <ActionForm key={round} action={grantInventoryAccess} submitLabel="Give access" pendingLabel="Saving…" onDone={() => { setRound((n) => n + 1); setSaved(true); }}>
        <input type="hidden" name="companyId" value={companyId} />
        <PersonPicker staff={staff} />
        <RightsFields idPrefix="inv-grant" viewerIsFounder={viewerIsFounder} defaults={[]} locations={locations} defaultLocationIds={[]} />
        <Field label="Note (optional)" htmlFor="inv-grant-note" hint="Why they need access. Kept in the history."><Input id="inv-grant-note" name="note" maxLength={200} /></Field>
      </ActionForm>
    </div>
  );
}

function ChangeForm({ person, companyId, viewerIsFounder, founderCount, locations, onDone }: { person: AccessPersonRow; companyId: string; viewerIsFounder: boolean; founderCount: number; locations: readonly AccessLocation[]; onDone: () => void }) {
  const onlyFounder = person.capabilities.includes("founder") && founderCount <= 1;
  return (
    <ActionForm action={grantInventoryAccess} submitLabel="Save changes" onDone={onDone} secondary={<Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="userId" value={person.userId} />
      <RightsFields idPrefix={`inv-edit-${person.userId}`} viewerIsFounder={viewerIsFounder} defaults={person.capabilities} locations={locations} defaultLocationIds={person.locationIds} lockFounder={onlyFounder} />
    </ActionForm>
  );
}

function PersonRow({ person, companyId, viewerIsFounder, founderCount, locations, isSelf }: { person: AccessPersonRow; companyId: string; viewerIsFounder: boolean; founderCount: number; locations: readonly AccessLocation[]; isSelf: boolean }) {
  const [dialog, setDialog] = useState<"change" | "revoke" | null>(null);
  const changeable = canChangeGrant(person.capabilities, viewerIsFounder);
  const lastFounder = wouldRemoveLastFounder(person.capabilities, [], founderCount);
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">{person.name}{isSelf ? <span className="ml-2 text-sm font-normal text-muted-foreground">(you)</span> : null}</p>
          {person.email ? <p className="break-all text-sm text-muted-foreground">{person.email}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {changeable ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => setDialog("change")}>Change<span className="sr-only"> access for {person.name}</span></Button>
              <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setDialog("revoke")}>Revoke<span className="sr-only"> access for {person.name}</span></Button>
            </>
          ) : <span className="text-sm text-muted-foreground">Only a founder can change this</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {person.capabilities.length === 0 ? <Badge variant="outline">Catalogue summary only</Badge> : person.capabilities.map((c) => <Badge key={c} variant={c === "founder" ? "default" : "outline"} className="whitespace-nowrap" title={INV_CAPABILITY_LABELS[c].description}>{INV_CAPABILITY_LABELS[c].label}</Badge>)}
      </div>
      <p className="text-sm text-muted-foreground">Works at: {worksAtWords(person, locations)}</p>
      <p className="text-sm text-muted-foreground">Access given {formatDate(person.grantedAt)}{person.grantedByName ? ` by ${person.grantedByName}` : ""}{person.note ? ` · ${person.note}` : ""}</p>
      <Modal open={dialog === "change"} onClose={() => setDialog(null)} title="Change access" description={person.name} size="wide">
        <ChangeForm person={person} companyId={companyId} viewerIsFounder={viewerIsFounder} founderCount={founderCount} locations={locations} onDone={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === "revoke"} onClose={() => setDialog(null)} title="Revoke Inventory access" description={person.name}>
        <ActionForm action={revokeInventoryAccess} submitLabel="Revoke access" pendingLabel="Revoking…" variant="destructive" onDone={() => setDialog(null)} secondary={<Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>}>
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="userId" value={person.userId} />
          <p className="text-sm">{isSelf ? "You are about to remove your own Inventory access. " : ""}{person.name} will lose access to Inventory for this company straight away, and their warehouse locations are removed. Records they created stay: history is never deleted. Their HR, Sales and Projects access is not affected.</p>
          {lastFounder ? <Alert variant="warning" role="status">This is the company&apos;s only founder. The database will refuse this until another founder exists.</Alert> : null}
        </ActionForm>
      </Modal>
    </li>
  );
}

export function PeopleList({ people, companyId, viewerIsFounder, locations, currentUserId }: { people: readonly AccessPersonRow[]; companyId: string; viewerIsFounder: boolean; locations: readonly AccessLocation[]; currentUserId: string }) {
  const [q, setQ] = useState("");
  const founderCount = people.filter((p) => p.capabilities.includes("founder")).length;
  const t = q.trim().toLowerCase();
  const shown = t ? people.filter((p) => p.name.toLowerCase().includes(t) || (p.email ?? "").toLowerCase().includes(t)) : people;
  if (people.length === 0) return <EmptyState dense title="Nobody has Inventory access to this company yet." description="Use Give access below. Nobody is given access automatically." />;
  return (
    <div className="space-y-3">
      {people.length > 6 ? (
        <div className="max-w-sm"><label htmlFor="inv-people-find" className="sr-only">Find a person</label><Input id="inv-people-find" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" /></div>
      ) : null}
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">No one matches &ldquo;{q}&rdquo;.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {shown.map((p) => <PersonRow key={p.userId} person={p} companyId={companyId} viewerIsFounder={viewerIsFounder} founderCount={founderCount} locations={locations} isSelf={p.userId === currentUserId} />)}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Cross-company sharing
// ---------------------------------------------------------------------------------------------------------------
export function SharingSection({ companyId, companyName, canEdit, allows, uses, others }: {
  companyId: string; companyName: string; canEdit: boolean; allows: readonly SharingRow[]; uses: readonly SharingRow[]; others: readonly { id: string; name: string }[];
}) {
  const [revoking, setRevoking] = useState<SharingRow | null>(null);
  const available = others.filter((o) => !allows.some((a) => a.otherCompanyId === o.id));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Equipment belongs to the company that owns it, wherever it is kept. Using it at another company&apos;s location, on another company&apos;s project or with another company&apos;s employee needs a founder of the owning company to allow it here. Moving equipment never changes who owns it.</p>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Companies allowed to use {companyName}&apos;s equipment</h3>
        {allows.length === 0 ? <p className="text-sm text-muted-foreground">None. {companyName}&apos;s equipment can only be used by {companyName}.</p> : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {allows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0"><p className="break-words font-medium">{r.otherCompanyName}</p><p className="text-sm text-muted-foreground">Since {formatDate(r.since)}{r.note ? ` · ${r.note}` : ""}</p></div>
                {canEdit ? <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setRevoking(r)}>Stop allowing<span className="sr-only">{` ${r.otherCompanyName}`}</span></Button> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {uses.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Equipment {companyName} is allowed to use</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {uses.map((r) => <li key={r.id} className="px-4 py-3"><p className="break-words font-medium">{r.otherCompanyName}</p><p className="text-sm text-muted-foreground">Allowed since {formatDate(r.since)}{r.note ? ` · ${r.note}` : ""}. The owner can withdraw this.</p></li>)}
          </ul>
        </div>
      ) : null}
      {canEdit ? (
        available.length === 0 ? <p className="text-sm text-muted-foreground">Every other company is already allowed, or there is no other company.</p> : (
          <ActionForm action={setInventoryCompanySharing} submitLabel="Allow this company" resetOnSuccess>
            <input type="hidden" name="ownerCompanyId" value={companyId} />
            <input type="hidden" name="enabled" value="true" />
            <Field label={`Allow this company to use ${companyName}'s equipment`} htmlFor="inv-share-use">
              <Select id="inv-share-use" name="useCompanyId" required defaultValue=""><option value="" disabled>Choose a company…</option>{available.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>
            </Field>
            <Field label="Note (optional)" htmlFor="inv-share-note" hint="For example the project or reason."><Input id="inv-share-note" name="note" maxLength={200} /></Field>
          </ActionForm>
        )
      ) : <p className="text-sm text-muted-foreground">Only a founder of {companyName} can allow or stop this.</p>}
      <Modal open={revoking !== null} onClose={() => setRevoking(null)} title="Stop allowing this company" description={revoking?.otherCompanyName}>
        {revoking ? (
          <ActionForm action={setInventoryCompanySharing} submitLabel="Stop allowing" pendingLabel="Saving…" variant="destructive" onDone={() => setRevoking(null)} secondary={<Button type="button" variant="ghost" onClick={() => setRevoking(null)}>Cancel</Button>}>
            <input type="hidden" name="ownerCompanyId" value={companyId} />
            <input type="hidden" name="useCompanyId" value={revoking.otherCompanyId} />
            <input type="hidden" name="enabled" value="false" />
            <p className="text-sm">{revoking.otherCompanyName} will no longer be able to use {companyName}&apos;s equipment for new movements. Equipment already there is not moved by this, and history is kept.</p>
          </ActionForm>
        ) : null}
      </Modal>
    </div>
  );
}
