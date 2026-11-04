"use client";

import { useEffect, useState } from "react";
import {
  ACCESS_MODULE_LABELS, ACCESS_PROFILES, ADVANCED_GROUPS, PROJECTS_PM_NOTE, capabilityInfo, capabilityToggleBlockedReason, chooseProfile, chooseScope, draftCapabilities,
  evaluateGrant, evaluateRevoke, initialDraft, normaliseCapabilities, reviewDraft, targetLockedForViewer, toggleExtra, type AccessDraft, type AccessModule, type WarehouseScope,
} from "@enginious-hr/domain";
import { applyModuleAccess, revokeModuleAccess } from "@/lib/actions/peopleAccess";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ActionForm, Field } from "@/components/sales/action-form";
import { worksAtWords } from "./module-access-card";

export interface ModuleAccessEditorProps {
  module: AccessModule;
  company: { id: string; name: string };
  viewerCapabilities: string[];
  person: { userId: string; name: string; isSelf: boolean };
  grant: { capabilities: string[] } | null;
  accessManagerCount: number;
  founderCount: number;
  approverCount?: number;
  locations: { id: string; name: string; isActive: boolean }[];
  assignedLocationIds: string[];
  onCancel: () => void;
  onDone: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

function Chips({ module, caps, tone }: { module: AccessModule; caps: readonly string[]; tone: "success" | "destructive" | "outline" }) {
  return <>{caps.map((c) => <Badge key={c} variant={tone} className="whitespace-nowrap" title={capabilityInfo(module, c).description}>{capabilityInfo(module, c).label}</Badge>)}</>;
}

/** Editing one module for one company: choose a working profile (prepares a draft only), review, then ONE Save changes. */
export function ModuleAccessEditor(props: ModuleAccessEditorProps) {
  const { module, company, viewerCapabilities, person, grant, accessManagerCount, founderCount, approverCount = 0, locations, assignedLocationIds, onCancel, onDone, onDirtyChange } = props;
  const original = grant ? normaliseCapabilities(module, grant.capabilities) : null;
  const start = initialDraft(module, original, assignedLocationIds);
  const [draft, setDraft] = useState<AccessDraft>(start);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [removing, setRemoving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(start);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const target = { capabilities: original ?? [], self: person.isSelf };
  const review = reviewDraft(module, draft, original, assignedLocationIds);
  const locked = original !== null && targetLockedForViewer(module, viewerCapabilities, original, person.isSelf);
  const revokeBlocked = original ? evaluateRevoke(module, viewerCapabilities, target).reason : null;
  const refusal = evaluateGrant(module, viewerCapabilities, target, review.caps).reason;
  const idPrefix = `pa-${module}-${company.id}`;
  const nothingChosen = original === null && review.caps.length === 0 && draft.profileId === null;
  const removalOk = !review.needsRemovalConfirm || confirmRemoval;
  const canSave = review.changed && !nothingChosen && !review.scopeMissing && !review.locationsMissing && removalOk && refusal === null;
  const before = original === null ? "" : original.length === 0 ? "-" : original.join(",");
  const losesLastManager = original?.includes("manage_access") && !review.caps.includes("manage_access") && accessManagerCount <= 1;
  const losesLastFounder = original?.includes("founder") && !review.caps.includes("founder") && founderCount <= 1;
  const losesLastApprover = module === "budget" && original?.includes("executive_approver") && !review.caps.includes("executive_approver") && approverCount <= 1;
  const removesLastManager = original?.includes("manage_access") && accessManagerCount <= 1;
  const removesLastFounder = original?.includes("founder") && founderCount <= 1;
  const removesLastApprover = module === "budget" && original?.includes("executive_approver") && approverCount <= 1;
  const visibleLocations = locations.filter((l) => l.isActive || draft.locationIds.includes(l.id));
  const set = (d: AccessDraft) => { setDraft(d); setConfirmRemoval(false); };

  if (locked) return <p className="text-sm text-muted-foreground">Only a founder can change this person&apos;s access.</p>;

  return (
    <section aria-label={`Edit ${ACCESS_MODULE_LABELS[module]} access`} className="space-y-4 rounded-md border-2 border-primary/40 p-4">
      <h4 className="text-sm font-semibold">{ACCESS_MODULE_LABELS[module]} · {company.name}</h4>
      <ActionForm action={applyModuleAccess} submitLabel="Save changes" pendingLabel="Saving…" className="space-y-4" disabled={!canSave} onDone={onDone}
        secondary={<Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}>
        <input type="hidden" name="module" value={module} />
        <input type="hidden" name="userId" value={person.userId} />
        <input type="hidden" name="companyId" value={company.id} />
        <input type="hidden" name="before" value={before} />
        {review.caps.map((c) => <input key={c} type="hidden" name="capabilities" value={c} />)}
        {review.needsScope && draft.scope === "chosen" ? <input type="hidden" name="withLocations" value="1" /> : null}
        {review.needsScope && draft.scope === "chosen" ? draft.locationIds.map((l) => <input key={l} type="hidden" name="locationIds" value={l} />) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Working profile</legend>
          <p className="text-sm text-muted-foreground">Choosing a profile only prepares the change below. Nothing is saved until you press Save changes.</p>
          {module === "projects" ? <p className="text-sm text-muted-foreground">{PROJECTS_PM_NOTE}</p> : null}
          <ul className="grid gap-2 sm:grid-cols-2">
            {ACCESS_PROFILES[module].map((p) => {
              const next = chooseProfile(module, draft, p.id, original);
              const reason = evaluateGrant(module, viewerCapabilities, target, draftCapabilities(module, next)).reason;
              return (
                <li key={p.id}>
                  <label htmlFor={`${idPrefix}-p-${p.id}`} className={`flex h-full items-start gap-2 rounded-md border p-3 text-sm ${draft.profileId === p.id ? "border-primary bg-primary/5" : "border-border"} ${reason ? "opacity-70" : "cursor-pointer"}`}>
                    <input id={`${idPrefix}-p-${p.id}`} type="radio" name={`${idPrefix}-profile`} className="mt-0.5 h-4 w-4" checked={draft.profileId === p.id} disabled={reason !== null} onChange={() => set(next)} />
                    <span className="min-w-0">
                      <span className="block font-medium">{p.label}{reason ? " (not available)" : ""}</span>
                      <span className="block text-muted-foreground">{p.description}</span>
                      <span className="block text-muted-foreground">Not included: {p.exclusions}</span>
                      {reason ? <span className="block text-muted-foreground">{reason}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {draft.profileId === null && original !== null ? <p className="text-sm text-muted-foreground">This person has custom access. Their rights are kept unless you change them.</p> : null}
        </fieldset>

        {review.needsScope ? (
          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">Warehouse scope (choose one)</legend>
            <p className="text-sm text-muted-foreground">Where this person may operate stock. This is never chosen for you.</p>
            {(["chosen", "all"] as WarehouseScope[]).map((s) => (
              <label key={s} htmlFor={`${idPrefix}-scope-${s}`} className="flex items-start gap-2 text-sm">
                <input id={`${idPrefix}-scope-${s}`} type="radio" name={`${idPrefix}-scope`} className="mt-0.5 h-4 w-4" checked={draft.scope === s} onChange={() => set(chooseScope(module, draft, s))} />
                <span>{s === "chosen" ? "Chosen warehouses only" : "All locations of this company, including ones added later"}</span>
              </label>
            ))}
            {draft.scope === "chosen" ? (
              visibleLocations.length === 0 ? <p className="text-sm text-muted-foreground">No locations have been set up for this company yet. A founder adds them under Setup.</p> : (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {visibleLocations.map((l) => (
                    <li key={l.id}><label className="flex items-center gap-2 text-sm" htmlFor={`${idPrefix}-loc-${l.id}`}><input id={`${idPrefix}-loc-${l.id}`} type="checkbox" className="h-4 w-4" checked={draft.locationIds.includes(l.id)} onChange={(e) => set({ ...draft, locationIds: e.target.checked ? [...draft.locationIds, l.id] : draft.locationIds.filter((x) => x !== l.id) })} />{l.name}{l.isActive ? "" : " (switched off)"}</label></li>
                  ))}
                </ul>
              )
            ) : null}
            {review.scopeMissing ? <p role="status" className="text-sm font-medium text-destructive">Choose a warehouse scope before saving.</p> : null}
            {review.locationsMissing ? <p role="status" className="text-sm font-medium text-destructive">Tick at least one warehouse.</p> : null}
          </fieldset>
        ) : null}

        <details className="rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Advanced access</summary>
          <p className="mt-2 text-sm text-muted-foreground">Every right in this module, for specialist cases. Rights of the chosen profile are shown ticked; unticking one makes the access custom and keeps the rest.</p>
          <div className="mt-2 space-y-4">
            {ADVANCED_GROUPS[module].map((g) => (
              <fieldset key={g.id} className="space-y-2">
                <legend className="text-sm font-semibold">{g.label}</legend>
                <ul className="space-y-2">
                  {g.capabilities.map((c) => {
                    const inProfile = (ACCESS_PROFILES[module].find((p) => p.id === draft.profileId)?.capabilities ?? []).includes(c);
                    const scopeOwned = module === "inventory" && c === "cross_location";
                    const reason = scopeOwned ? null : capabilityToggleBlockedReason(module, viewerCapabilities, target, review.caps, c);
                    const info = capabilityInfo(module, c);
                    return (
                      <li key={c}>
                        <label className="flex items-start gap-2 text-sm" htmlFor={`${idPrefix}-${c}`}>
                          <input id={`${idPrefix}-${c}`} type="checkbox" className="mt-0.5 h-4 w-4" checked={review.caps.includes(c)} disabled={scopeOwned || reason !== null}
                            onChange={(e) => set(toggleExtra(module, draft, c, e.target.checked))} />
                          <span className="min-w-0"><span className="font-medium">{info.label}</span>
                            {reason ? <span className="text-muted-foreground"> (not available)</span> : null}
                            {inProfile ? <span className="text-muted-foreground"> (part of the profile; unticking it makes the access custom)</span> : null}
                            {scopeOwned ? <span className="text-muted-foreground"> (set under Warehouse scope)</span> : null}
                            <span className="block text-muted-foreground">{info.description}</span>{reason ? <span className="block text-muted-foreground">{reason}</span> : null}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
        </details>

        <div aria-live="polite" className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
          <p className="font-medium">Review before saving</p>
          <p><span className="text-muted-foreground">Company:</span> {company.name} · <span className="text-muted-foreground">Module:</span> {ACCESS_MODULE_LABELS[module]}{review.profile ? <> · <span className="text-muted-foreground">Profile:</span> {review.profile.label}</> : null}</p>
          {!review.changed ? <p className="text-muted-foreground">No change yet. {original === null ? "Choose a profile to give access." : "They keep everything they have now."}</p> : null}
          {review.added.length > 0 ? <div className="flex flex-wrap items-center gap-1.5"><span>Rights added</span><Chips module={module} caps={review.added} tone="success" /></div> : null}
          {review.removed.length > 0 ? <div className="flex flex-wrap items-center gap-1.5"><span>Rights removed</span><Chips module={module} caps={review.removed} tone="destructive" /></div> : null}
          {review.retained.length > 0 ? <div className="flex flex-wrap items-center gap-1.5"><span>Custom rights kept</span><Chips module={module} caps={review.retained} tone="outline" /></div> : null}
          {review.needsScope ? <p><span className="text-muted-foreground">Warehouse scope:</span> {draft.scope === null ? "not chosen yet" : worksAtWords(review.caps, draft.scope === "chosen" ? draft.locationIds : [], locations)}</p> : null}
          <div>
            <p className="text-muted-foreground">Resulting access</p>
            <ul className="list-disc space-y-0.5 pl-5">{review.summary.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
          {review.needsRemovalConfirm ? (
            <label className="flex items-start gap-2" htmlFor={`${idPrefix}-confirm-removal`}>
              <input id={`${idPrefix}-confirm-removal`} type="checkbox" className="mt-0.5 h-4 w-4" checked={confirmRemoval} onChange={(e) => setConfirmRemoval(e.target.checked)} />
              <span>I confirm these rights are removed from {person.name}.</span>
            </label>
          ) : null}
        </div>
        {refusal ? <p role="status" className="text-sm text-muted-foreground">{refusal}</p> : null}
        {losesLastManager ? <Alert variant="warning" role="status">{person.name} is the last person who manages this access for {company.name}. The database will refuse this until someone else holds that right.</Alert> : null}
        {losesLastApprover ? <Alert variant="warning" role="status">{person.name} is the only CEO / CTO approver of {company.name}. The database will refuse this while no other active approver exists.</Alert> : null}
        {losesLastFounder ? <Alert variant="warning" role="status">{person.name} is the only founder of {company.name}. The database will refuse this until another founder exists.</Alert> : null}
        {person.isSelf && review.removed.length > 0 ? <Alert role="status">You are changing your own access.</Alert> : null}

        <Field label="Why (optional)" htmlFor={`${idPrefix}-note`} hint="Kept with the grant, in the history.">
          <Input id={`${idPrefix}-note`} name="note" maxLength={200} />
        </Field>
      </ActionForm>

      {original !== null && revokeBlocked === null ? (
        <div className="border-t border-border pt-3">
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => setRemoving(true)}>Remove all access to this module<span className="sr-only"> ({ACCESS_MODULE_LABELS[module]}) for {person.name}</span></Button>
        </div>
      ) : original !== null ? <p className="text-sm text-muted-foreground">Access cannot be removed here. {revokeBlocked}</p> : null}

      <Modal open={removing} onClose={() => setRemoving(false)} title={`Remove all ${ACCESS_MODULE_LABELS[module]} access`} description={`${person.name} · ${company.name}`}>
        <ActionForm action={revokeModuleAccess} submitLabel="Remove all access" pendingLabel="Removing…" variant="destructive" onDone={() => { setRemoving(false); onDone(); }}
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
