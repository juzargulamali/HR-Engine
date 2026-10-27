"use client";

import { useState } from "react";
import {
  ACCESS_MODULE_LABELS, ACCESS_PRESETS, applyPreset, capabilitiesOf, capabilityInfo, describeAccess, diffCapabilities, capabilityToggleBlockedReason, evaluateRevoke,
  isNoChange, normaliseCapabilities, presetBlockedReason, presetById, targetLockedForViewer, type AccessModule,
} from "@enginious-hr/domain";
import { applyModuleAccess, revokeModuleAccess } from "@/lib/actions/peopleAccess";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ActionForm, Field } from "@/components/sales/action-form";
import { formatDate } from "@/components/sales/format";

export interface ModuleAccessCardProps {
  module: AccessModule;
  company: { id: string; name: string };
  viewerCapabilities: string[];
  person: { userId: string; name: string; isSelf: boolean };
  /** What the person holds now (null: no access to this module in this company). */
  grant: { capabilities: string[]; grantedAt: string; grantedByName: string | null; note: string | null } | null;
  /** Holders of the access-management and founder rights of this company, for the "last one" warnings (the database refuses those too). */
  accessManagerCount: number;
  founderCount: number;
  /** Holders of the CEO / CTO approver right (Budget); the database counts only active ones, so this can overstate. */
  approverCount?: number;
  locations: { id: string; name: string; isActive: boolean }[];
  assignedLocationIds: string[];
}

/** Where a warehouse operator works, in words (the same sentences the Inventory screen used). */
export function worksAtWords(capabilities: readonly string[], assigned: readonly string[], locations: readonly { id: string; name: string }[]): string {
  if (capabilities.includes("founder")) return "All locations (founder)";
  if (capabilities.includes("cross_location")) return "All locations";
  if (!capabilities.includes("warehouse")) return "—";
  const names = assigned.map((id) => locations.find((l) => l.id === id)?.name).filter(Boolean) as string[];
  return names.length > 0 ? names.join(", ") : "No location yet (cannot operate stock)";
}

export function AccessSummary({ module, capabilities }: { module: AccessModule; capabilities: readonly string[] }) {
  const d = describeAccess(module, capabilities);
  if (d.basic) return <Badge variant="outline">{ACCESS_PRESETS[module][0] && ACCESS_PRESETS[module][0].capabilities.length === 0 ? ACCESS_PRESETS[module][0].label : "No extra rights"}</Badge>;
  return (
    <>
      {d.presets.map((p) => <Badge key={p.id} variant={p.capabilities.includes("founder") ? "default" : "outline"} className="whitespace-nowrap" title={p.summary}>{p.label}</Badge>)}
      {d.extra.map((c) => <Badge key={c} variant="outline" className="whitespace-nowrap" title={capabilityInfo(module, c).description}>{capabilityInfo(module, c).label}</Badge>)}
    </>
  );
}

function Chips({ module, caps, tone }: { module: AccessModule; caps: readonly string[]; tone: "success" | "destructive" | "outline" }) {
  return <>{caps.map((c) => <Badge key={c} variant={tone} className="whitespace-nowrap" title={capabilityInfo(module, c).description}>{capabilityInfo(module, c).label}</Badge>)}</>;
}

export function ModuleAccessCard(props: ModuleAccessCardProps) {
  const { module, company, viewerCapabilities, person, grant, accessManagerCount, founderCount, approverCount = 0, locations, assignedLocationIds } = props;
  const original = grant?.capabilities ?? [];
  const [caps, setCaps] = useState<string[]>(original);
  const [presetId, setPresetId] = useState("");
  const [locIds, setLocIds] = useState<string[]>(assignedLocationIds);
  const [removing, setRemoving] = useState(false);

  // The access grant rules, as the database applies them: the screen disables what would be refused and says why.
  const target = { capabilities: original, self: person.isSelf };
  const locked = grant !== null && targetLockedForViewer(module, viewerCapabilities, original, person.isSelf);
  const revokeBlocked = grant ? evaluateRevoke(module, viewerCapabilities, target).reason : null;
  const presetReasons = new Map(ACCESS_PRESETS[module].map((p) => [p.id, presetBlockedReason(module, viewerCapabilities, p, target, caps)] as const));
  const distinctReasons = [...new Set([...presetReasons.values()].filter((r): r is string => r !== null))];
  const diff = diffCapabilities(module, original, caps);
  const locationsChanged = [...locIds].sort().join(",") !== [...assignedLocationIds].sort().join(",");
  const needsLocations = module === "inventory" && caps.includes("warehouse") && !caps.includes("cross_location") && !caps.includes("founder");
  const changed = grant === null ? (module !== "budget" || caps.length > 0) : !isNoChange(diff) || (needsLocations && locationsChanged);
  const losesLastManager = grant?.capabilities.includes("manage_access") && !caps.includes("manage_access") && accessManagerCount <= 1;
  const losesLastFounder = grant?.capabilities.includes("founder") && !caps.includes("founder") && founderCount <= 1;
  const removesLastManager = grant?.capabilities.includes("manage_access") && accessManagerCount <= 1;
  const removesLastFounder = grant?.capabilities.includes("founder") && founderCount <= 1;
  const losesLastApprover = module === "budget" && original.includes("executive_approver") && !caps.includes("executive_approver") && approverCount <= 1;
  const removesLastApprover = module === "budget" && original.includes("executive_approver") && approverCount <= 1;
  const idPrefix = `pa-${module}-${company.id}`;
  const before = grant === null ? "" : original.length === 0 ? "-" : original.join(",");

  function addPreset() {
    const preset = presetById(module, presetId);
    if (!preset) return;
    setCaps(applyPreset(module, caps, preset));
    setPresetId("");
  }
  const toggle = (c: string, on: boolean) => setCaps((prev) => normaliseCapabilities(module, on ? [...prev, c] : prev.filter((x) => x !== c)));

  return (
    <section aria-labelledby={`${idPrefix}-h`} className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`${idPrefix}-h`} className="text-sm font-semibold">{ACCESS_MODULE_LABELS[module]}</h3>
        {grant ? <span className="text-sm text-muted-foreground">Given {formatDate(grant.grantedAt)}{grant.grantedByName ? ` by ${grant.grantedByName}` : ""}{grant.note ? ` · ${grant.note}` : ""}</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {grant ? <AccessSummary module={module} capabilities={grant.capabilities} /> : <span className="text-sm text-muted-foreground">No access to {ACCESS_MODULE_LABELS[module]} in {company.name}.</span>}
      </div>
      {module === "inventory" && grant && (grant.capabilities.includes("warehouse") || grant.capabilities.includes("founder")) ? (
        <p className="text-sm text-muted-foreground">Works at: {worksAtWords(grant.capabilities, assignedLocationIds, locations)}</p>
      ) : null}

      {locked ? (
        <p className="text-sm text-muted-foreground">Only a founder can change this person&apos;s access, because they hold a founder, access-management{module === "inventory" ? " or cost" : ""} right.</p>
      ) : (
        <ActionForm action={applyModuleAccess} submitLabel={grant ? "Save changes" : "Give access"} pendingLabel="Saving…" className="space-y-3" disabled={!changed}
          secondary={grant && revokeBlocked === null ? <Button type="button" variant="ghost" className="text-destructive" onClick={() => setRemoving(true)}>Remove access{" "}<span className="sr-only">to {ACCESS_MODULE_LABELS[module]} for {person.name}</span></Button> : undefined}>
          <input type="hidden" name="module" value={module} />
          <input type="hidden" name="userId" value={person.userId} />
          <input type="hidden" name="companyId" value={company.id} />
          <input type="hidden" name="before" value={before} />
          {caps.map((c) => <input key={c} type="hidden" name="capabilities" value={c} />)}
          {needsLocations ? <input type="hidden" name="withLocations" value="1" /> : null}
          {needsLocations ? locIds.map((l) => <input key={l} type="hidden" name="locationIds" value={l} />) : null}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <label htmlFor={`${idPrefix}-preset`} className="mb-1 block text-sm font-medium">{grant ? "Add to their access" : "Give access"}</label>
              <Select id={`${idPrefix}-preset`} value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                <option value="">Choose a preset…</option>
                {ACCESS_PRESETS[module].map((p) => {
                  const blocked = presetReasons.get(p.id) ?? null;
                  return <option key={p.id} value={p.id} disabled={blocked !== null} title={blocked ?? undefined}>{p.label}{blocked ? " (not available)" : ""}</option>;
                })}
              </Select>
            </div>
            <Button type="button" variant="outline" disabled={presetId === ""} onClick={addPreset}>Add preset</Button>
          </div>
          {presetId ? <p className="text-sm text-muted-foreground">{presetById(module, presetId)?.summary}{presetById(module, presetId)?.note ? ` ${presetById(module, presetId)?.note}` : ""}</p> : null}
          {distinctReasons.map((r) => <p key={r} className="text-sm text-muted-foreground">{r}</p>)}
          {grant && revokeBlocked ? <p className="text-sm text-muted-foreground">Access cannot be removed here. {revokeBlocked}</p> : null}

          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">Choose rights one by one</summary>
            <ul className="mt-2 space-y-2">
              {capabilitiesOf(module).map((c) => {
                const reason = capabilityToggleBlockedReason(module, viewerCapabilities, target, caps, c);
                const canTick = reason === null;
                const info = capabilityInfo(module, c);
                return (
                  <li key={c}>
                    <label className="flex items-start gap-2 text-sm" htmlFor={`${idPrefix}-${c}`}>
                      <input id={`${idPrefix}-${c}`} type="checkbox" className="mt-0.5 h-4 w-4" checked={caps.includes(c)} disabled={!canTick} onChange={(e) => toggle(c, e.target.checked)} />
                      <span className="min-w-0"><span className="font-medium">{info.label}</span>{!canTick ? <span className="text-muted-foreground"> (not available)</span> : null}<span className="block text-muted-foreground">{info.description}</span>{reason ? <span className="block text-muted-foreground">{reason}</span> : null}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </details>

          {needsLocations ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Locations this person works at</legend>
              <p className="text-sm text-muted-foreground">A warehouse operator can receive, issue, return, transfer and count only at the locations ticked here. To cover every location, including ones added later, add &ldquo;Stock lead (all locations)&rdquo;.</p>
              {locations.filter((l) => l.isActive || locIds.includes(l.id)).length === 0 ? <p className="text-sm text-muted-foreground">No locations have been set up for this company yet. A founder adds them under Setup.</p> : (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {locations.filter((l) => l.isActive || locIds.includes(l.id)).map((l) => (
                    <li key={l.id}><label className="flex items-center gap-2 text-sm" htmlFor={`${idPrefix}-loc-${l.id}`}><input id={`${idPrefix}-loc-${l.id}`} type="checkbox" className="h-4 w-4" checked={locIds.includes(l.id)} onChange={(e) => setLocIds((prev) => e.target.checked ? [...prev, l.id] : prev.filter((x) => x !== l.id))} />{l.name}{l.isActive ? "" : " (switched off)"}</label></li>
                  ))}
                </ul>
              )}
              {locIds.length === 0 ? <p className="text-sm text-muted-foreground">With no location ticked, this person has the warehouse right but cannot operate stock anywhere yet.</p> : null}
            </fieldset>
          ) : null}

          <div aria-live="polite" className="space-y-1.5 rounded-md bg-muted/40 p-3 text-sm">
            <p className="font-medium">{grant ? "What this change does" : "What will be given"}</p>
            {grant === null ? (
              caps.length === 0 ? <p className="text-muted-foreground">{module === "budget" ? "Nothing yet. Add a preset." : "Basic access only, with no extra rights."}</p> : <div className="flex flex-wrap gap-1.5"><Chips module={module} caps={caps} tone="success" /></div>
            ) : isNoChange(diff) && !(needsLocations && locationsChanged) ? (
              <p className="text-muted-foreground">No change. They keep everything they have now.</p>
            ) : (
              <>
                {diff.added.length > 0 ? <div className="flex flex-wrap items-center gap-1.5"><span>Adds</span><Chips module={module} caps={diff.added} tone="success" /></div> : null}
                {diff.removed.length > 0 ? <div className="flex flex-wrap items-center gap-1.5"><span>Removes</span><Chips module={module} caps={diff.removed} tone="destructive" /></div> : null}
                {diff.added.length === 0 && diff.removed.length === 0 ? <p className="text-muted-foreground">Only the locations change.</p> : null}
                <p className="text-muted-foreground">Everything else they have stays as it is.</p>
              </>
            )}
          </div>
          {losesLastManager ? <Alert variant="warning" role="status">{person.name} is the last person who manages this access for {company.name}. The database will refuse this until someone else holds that right.</Alert> : null}
          {losesLastApprover ? <Alert variant="warning" role="status">{person.name} is the only CEO / CTO approver of {company.name}. The database will refuse this while no other active approver exists.</Alert> : null}
          {losesLastFounder ? <Alert variant="warning" role="status">{person.name} is the only founder of {company.name}. The database will refuse this until another founder exists.</Alert> : null}
          {person.isSelf && diff.removed.length > 0 ? <Alert role="status">You are changing your own access.</Alert> : null}

          <Field label="Why (optional)" htmlFor={`${idPrefix}-note`} hint="Kept with the grant, in the history.">
            <Input id={`${idPrefix}-note`} name="note" maxLength={200} />
          </Field>
        </ActionForm>
      )}

      <Modal open={removing} onClose={() => setRemoving(false)} title={`Remove ${ACCESS_MODULE_LABELS[module]} access`} description={`${person.name} · ${company.name}`}>
        <ActionForm action={revokeModuleAccess} submitLabel="Remove access" pendingLabel="Removing…" variant="destructive" onDone={() => setRemoving(false)}
          secondary={<Button type="button" variant="ghost" onClick={() => setRemoving(false)}>Cancel</Button>}>
          <input type="hidden" name="module" value={module} />
          <input type="hidden" name="userId" value={person.userId} />
          <input type="hidden" name="companyId" value={company.id} />
          <p className="text-sm">{person.isSelf ? "You are about to remove your own access. " : ""}{person.name} will lose access to {ACCESS_MODULE_LABELS[module]} for {company.name} straight away. Records they created stay: history is never deleted. Their HR roles and other modules are not affected.</p>
          {removesLastManager ? <Alert variant="warning" role="status">This is the last person who manages this access. The database will refuse this until someone else holds that right.</Alert> : null}
          {removesLastApprover ? <Alert variant="warning" role="status">This is the only CEO / CTO approver of this company. The database will refuse this while no other active approver exists.</Alert> : null}
          {removesLastFounder ? <Alert variant="warning" role="status">This is the company&apos;s only founder. The database will refuse this until another founder exists.</Alert> : null}
        </ActionForm>
      </Modal>
    </section>
  );
}
