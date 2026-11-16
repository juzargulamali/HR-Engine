"use client";

import { startTransition, useActionState, useState } from "react";
import { saveOnboardingPlan, type OnboardingActionState } from "@/lib/actions/onboarding";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export interface PlanRole { value: string; label: string; privileged: boolean }
export interface PlanPreset { id: string; label: string; summary: string; capabilities: string[] }
export interface PlanModule { value: string; label: string; presets: PlanPreset[] }
export interface PlanCompany { id: string; name: string }
export interface PlanState {
  inviteEmail: string | null;
  hrRoles: { role: string; companyId: string }[];
  modules: { module: string; companyId: string; capabilities: string[]; note?: string | null }[];
}

const initialState: OnboardingActionState = { error: null };
const CUSTOM = "__custom__";

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

/**
 * The plan: the invitation address, the HR roles and the module rights somebody intends for this employee. Saving grants nothing: each line is applied afterwards by the person who is allowed to apply it,
 * and the exact list is shown in the review before anything is applied. Roles and rights are chosen per company.
 */
export function OnboardingPlanForm({ employeeId, companies, modules, roles, plan }: { employeeId: string; companies: PlanCompany[]; modules: PlanModule[]; roles: PlanRole[]; plan: PlanState }) {
  const [state, formAction, pending] = useActionState(saveOnboardingPlan, initialState);
  const [email, setEmail] = useState(plan.inviteEmail ?? "");
  const [chosenRoles, setChosenRoles] = useState(() => new Set(plan.hrRoles.map((r) => `${r.role}:${r.companyId}`)));
  const initialModules = () => {
    const out: Record<string, string> = {};
    for (const m of plan.modules) {
      const mod = modules.find((x) => x.value === m.module);
      const preset = mod?.presets.find((p) => sameSet(p.capabilities, m.capabilities));
      out[`${m.module}:${m.companyId}`] = preset ? preset.id : CUSTOM;
    }
    return out;
  };
  const [chosenModules, setChosenModules] = useState<Record<string, string>>(initialModules);
  const customCaps = (module: string, companyId: string) => plan.modules.find((m) => m.module === module && m.companyId === companyId)?.capabilities ?? [];

  const toggleRole = (key: string) => setChosenRoles((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const hrRoles = [...chosenRoles].map((k) => { const [role, companyId] = k.split(":"); return { role: role!, companyId: companyId! }; });
    const mods = Object.entries(chosenModules).filter(([, v]) => v !== "").map(([k, v]) => {
      const [module, companyId] = k.split(":");
      const preset = modules.find((m) => m.value === module)?.presets.find((p) => p.id === v);
      return { module: module!, companyId: companyId!, capabilities: v === CUSTOM ? customCaps(module!, companyId!) : (preset?.capabilities ?? []), note: null };
    });
    const fd = new FormData();
    fd.set("employeeId", employeeId);
    fd.set("plan", JSON.stringify({ inviteEmail: email.trim() === "" ? null : email.trim(), hrRoles, modules: mods }));
    startTransition(() => formAction(fd));
  }

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="onboarding-plan-form" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="inviteEmail">Work email address</Label>
        <Input id="inviteEmail" name="inviteEmail" type="email" autoComplete="off" className="h-11" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.example" />
        <p className="text-sm text-muted-foreground">Used to find an existing account or to send the invitation. An existing account is linked, never invited twice.</p>
      </div>

      {companies.map((c) => (
        <fieldset key={c.id} className="space-y-4 rounded-md border border-border p-4" data-testid={`plan-company-${c.id}`}>
          <legend className="px-1 text-sm font-medium">{c.name}</legend>
          <div className="space-y-2">
            <p className="text-sm font-medium">HR roles</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {roles.map((r) => {
                const key = `${r.value}:${c.id}`;
                return (
                  <label key={key} className="flex min-h-9 items-center gap-2 text-sm">
                    <input type="checkbox" checked={chosenRoles.has(key)} onChange={() => toggleRole(key)} className="h-4 w-4" />
                    {r.label}
                    {r.privileged ? <span className="text-xs text-muted-foreground">(wide access)</span> : null}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {modules.map((m) => {
              const key = `${m.value}:${c.id}`;
              const value = chosenModules[key] ?? "";
              return (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`mod-${key}`}>{m.label}</Label>
                  <Select id={`mod-${key}`} className="h-11" value={value} onChange={(e) => setChosenModules((s) => ({ ...s, [key]: e.target.value }))}>
                    <option value="">No access</option>
                    {m.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    {value === CUSTOM ? <option value={CUSTOM}>Custom rights (kept as saved)</option> : null}
                  </Select>
                  {value && value !== CUSTOM ? <p className="text-sm text-muted-foreground">{m.presets.find((p) => p.id === value)?.summary}</p> : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      {state.error ? <Alert variant="destructive" data-testid="plan-error">{state.error}</Alert> : null}
      {state.notice && !state.error ? <Alert variant="success" data-testid="plan-notice">{state.notice}</Alert> : null}
      <Button type="submit" className="min-h-11" disabled={pending}>{pending ? "Saving..." : "Save plan"}</Button>
    </form>
  );
}
