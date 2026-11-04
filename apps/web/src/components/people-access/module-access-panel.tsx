"use client";

import { useCallback, useState } from "react";
import { ACCESS_MODULES, ACCESS_MODULE_LABELS, type AccessModule } from "@enginious-hr/domain";
import type { PaGrant, PaModuleContext } from "@/lib/people-access/data";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ModuleAccessCard } from "./module-access-card";
import { ModuleAccessEditor } from "./module-access-editor";
import { useUnsavedAccessGuard } from "./unsaved-access-guard";

export interface ModuleAccessPanelProps {
  person: { userId: string; name: string; isSelf: boolean; employeeCompanyId: string | null };
  /** Every (module, company) the viewer may manage. */
  contexts: PaModuleContext[];
  grants: PaGrant[];
  operatorLocations: Record<string, string[]>;
  retryHref: string;
}

/** The company this person's access is shown for: their employment company when the viewer is authorised for it, else the first company the viewer manages. */
export function defaultAccessCompany(employeeCompanyId: string | null, companies: { id: string }[]): string | null {
  if (employeeCompanyId && companies.some((c) => c.id === employeeCompanyId)) return employeeCompanyId;
  return companies[0]?.id ?? null;
}

/** Module access for one person. Keyed by person, so company, editor, draft and every tick start fresh for each person and never carry over. */
export function ModuleAccessPanel(props: ModuleAccessPanelProps) {
  return <PersonModuleAccess key={props.person.userId} {...props} />;
}

/** Module access for one person: ONE explicit company, a compact card per module, and one editor at a time. Switching company saves nothing. */
function PersonModuleAccess({ person, contexts, grants, operatorLocations, retryHref }: ModuleAccessPanelProps) {
  const guard = useUnsavedAccessGuard();
  const companies = [...new Map(contexts.map((c) => [c.company.id, c.company])).values()];
  const [companyId, setCompanyId] = useState(() => defaultAccessCompany(person.employeeCompanyId, companies));
  const [editing, setEditing] = useState<AccessModule | null>(null);
  const [dirty, setDirty] = useState(false);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const setGuardDirty = guard?.setDirty;
  const onDirtyChange = useCallback((d: boolean) => { setDirty(d); setGuardDirty?.(d); }, [setGuardDirty]);

  const company = companies.find((c) => c.id === companyId);
  if (!company) return <p className="text-sm text-muted-foreground">There is no company whose module access you manage.</p>;

  const move = (id: string) => { setEditing(null); setDirty(false); setCompanyId(id); setSwitchTo(null); };
  const choose = (id: string) => { if (id === companyId) return; if (dirty) setSwitchTo(id); else move(id); };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <label htmlFor="pa-access-company" className="mb-1 block text-sm font-medium">Access for company</label>
        <Select id="pa-access-company" value={company.id} onChange={(e) => choose(e.target.value)} className="max-w-sm">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <p className="mt-1 text-sm text-muted-foreground">Module access is given per company. Everything below is for {company.name} only. Changing this selector saves nothing.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {ACCESS_MODULES.map((module) => {
          const ctx = contexts.find((c) => c.module === module && c.company.id === company.id);
          const grant = grants.find((g) => g.module === module && g.companyId === company.id) ?? null;
          const assigned = operatorLocations[company.id] ?? [];
          if (ctx && editing === module) {
            return (
              <div key={module} className="md:col-span-2">
                <ModuleAccessEditor
                  module={module} company={company} viewerCapabilities={ctx.viewerCapabilities} person={person} grant={grant ? { capabilities: grant.capabilities } : null}
                  accessManagerCount={ctx.holders.filter((h) => h.capabilities.includes("manage_access")).length}
                  founderCount={ctx.holders.filter((h) => h.capabilities.includes("founder")).length}
                  approverCount={ctx.holders.filter((h) => h.capabilities.includes("executive_approver")).length}
                  locations={ctx.locations} assignedLocationIds={assigned}
                  onCancel={() => { setEditing(null); setDirty(false); }} onDone={() => { setEditing(null); setDirty(false); }} onDirtyChange={onDirtyChange}
                />
              </div>
            );
          }
          return (
            <ModuleAccessCard
              key={module} module={module} companyName={company.name} manageable={!!ctx} readFailed={ctx?.readFailed ?? false} retryHref={retryHref}
              viewerCapabilities={ctx?.viewerCapabilities ?? []} person={person} grant={grant} locations={ctx?.locations ?? []} assignedLocationIds={assigned}
              onEdit={() => { if (dirty) return; setEditing(module); }}
            />
          );
        })}
      </div>

      <Modal open={switchTo !== null} onClose={() => setSwitchTo(null)} title="Discard unsaved changes?" description={`You have unsaved changes to ${editing ? ACCESS_MODULE_LABELS[editing] : "access"} for ${company.name}.`}>
        <div className="space-y-3">
          <p className="text-sm">Switching company discards them. Nothing has been saved.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setSwitchTo(null)}>Keep editing</Button>
            <Button type="button" variant="destructive" onClick={() => switchTo && move(switchTo)}>Discard and switch</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
