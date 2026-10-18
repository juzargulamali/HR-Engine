"use client";

import { grantProjectsAccess, revokeProjectsAccess } from "@/lib/actions/projectsCore";
import { PROJ_CAPABILITIES, PROJ_CAPABILITY_LABELS, type ProjCapability } from "@enginious-hr/domain";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ActionForm, Field } from "@/components/sales/action-form";

const FOUNDER_ONLY: ProjCapability[] = ["founder", "manage_access"];

function Capabilities({ idPrefix, isFounder, selected, locked }: { idPrefix: string; isFounder: boolean; selected: readonly ProjCapability[]; locked: boolean }) {
  return (
    <fieldset className="space-y-2" disabled={locked}>
      <legend className="text-sm font-medium">Rights (none ticked means the directory only)</legend>
      {PROJ_CAPABILITIES.map((c) => {
        const founderOnly = FOUNDER_ONLY.includes(c);
        const disabled = founderOnly && !isFounder;
        return (
          <label key={c} htmlFor={`${idPrefix}-${c}`} className={`flex items-start gap-2 text-sm ${disabled ? "opacity-60" : ""}`}>
            <input id={`${idPrefix}-${c}`} type="checkbox" name="capabilities" value={c} defaultChecked={selected.includes(c)} disabled={disabled} className="mt-0.5 h-4 w-4" />
            <span>
              <span className="font-medium">{PROJ_CAPABILITY_LABELS[c].label}</span>
              {founderOnly ? <span className="text-muted-foreground"> (founders only)</span> : null}
              <span className="block text-muted-foreground">{PROJ_CAPABILITY_LABELS[c].description}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function NewGrantForm({ companyId, staff, isFounder }: { companyId: string; staff: { id: string; name: string; email: string | null }[]; isFounder: boolean }) {
  return (
    <ActionForm action={grantProjectsAccess} submitLabel="Give access" resetOnSuccess>
      <input type="hidden" name="companyId" value={companyId} />
      <Field label="Person" htmlFor={`g-user-${companyId}`} hint="Active staff only. Giving access lets them see the directory of ongoing projects; they see a project's details only when added to it.">
        <Select id={`g-user-${companyId}`} name="userId" required defaultValue="">
          <option value="" disabled>Choose a person…</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.email ? ` (${s.email})` : ""}</option>)}
        </Select>
      </Field>
      <Capabilities idPrefix={`g-${companyId}`} isFounder={isFounder} selected={[]} locked={false} />
      <Field label="Note (optional)" htmlFor={`g-note-${companyId}`}><Input id={`g-note-${companyId}`} name="note" maxLength={200} placeholder="Why they have access" /></Field>
    </ActionForm>
  );
}

export function EditGrantForm({ companyId, userId, caps, isFounder, lockedForMe }: { companyId: string; userId: string; caps: readonly ProjCapability[]; isFounder: boolean; lockedForMe: boolean }) {
  return (
    <ActionForm action={grantProjectsAccess} submitLabel="Save rights">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="userId" value={userId} />
      {/* A disabled checkbox is not submitted, so a founder-only right this person holds would be dropped silently: send it explicitly. */}
      {!isFounder ? caps.filter((c) => FOUNDER_ONLY.includes(c)).map((c) => <input key={c} type="hidden" name="capabilities" value={c} />) : null}
      <Capabilities idPrefix={`e-${companyId}-${userId}`} isFounder={isFounder} selected={caps} locked={lockedForMe} />
      {lockedForMe ? <p className="text-sm text-muted-foreground">Only a founder can change a founder&apos;s or an access manager&apos;s rights.</p> : null}
    </ActionForm>
  );
}

export function RevokeForm({ companyId, userId, name }: { companyId: string; userId: string; name: string }) {
  return (
    <ActionForm action={revokeProjectsAccess} submitLabel={`Withdraw ${name}'s access`} variant="destructive" pendingLabel="Withdrawing…">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="userId" value={userId} />
      <p className="text-sm text-muted-foreground">They lose access to every project of this company at once: details, discussion, files and notices. Their memberships are closed and are not restored if access is given again. A Project Manager or department head of a live project cannot be withdrawn until someone else takes the role.</p>
    </ActionForm>
  );
}
