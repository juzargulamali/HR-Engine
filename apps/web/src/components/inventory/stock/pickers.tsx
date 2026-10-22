"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { EmployeeHit } from "@/lib/actions/inventoryStock";
import type { FormProject, FormRequest } from "@/lib/inventory/stock-candidates";

export interface PickedEmployee { id: string; name: string }

/**
 * Chooses an employee by typing part of the name or number. The database answers (inv_employee_lookup): active employees only and nothing
 * but their name, number and department. Nothing is chosen until the person picks a row.
 */
export function EmployeePicker({ label, companyId, value, onChange, lookup, disabled, hint }: {
  label: string; companyId: string; value: PickedEmployee | null; onChange: (e: PickedEmployee | null) => void;
  lookup: (companyId: string, q: string) => Promise<{ error: string | null; people: EmployeeHit[] }>; disabled?: boolean; hint?: string;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<EmployeeHit[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (value || q.trim().length < 2 || !companyId) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      setSearching(true);
      lookup(companyId, q)
        .then((r) => { if (mine === seq.current) { setPeople(r.people); setProblem(r.error); } })
        .catch(() => { if (mine === seq.current) { setPeople([]); setProblem("The search could not be done. Try again."); } })
        .finally(() => { if (mine === seq.current) setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [q, companyId, value, lookup]);

  if (value) {
    return (
      <div className="space-y-1.5">
        <span className="text-sm font-medium leading-none">{label}</span>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="min-w-0 break-words font-medium">{value.name}</span>
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { onChange(null); setQ(""); setPeople([]); }} aria-label={`Change ${label.toLowerCase()}`}>
            <X className="h-3.5 w-3.5" aria-hidden /> Change
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium leading-none">{label}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input id={id} value={q} disabled={disabled || !companyId} onChange={(e) => setQ(e.target.value)} placeholder={companyId ? "Type a name or employee number" : "Choose the location first"} className="pl-9" autoComplete="off" maxLength={80} />
      </div>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
      {q.trim().length >= 2 && !searching && !problem && people.length === 0 ? <p className="text-sm text-muted-foreground" role="status">No active employee matches that.</p> : null}
      {people.length > 0 ? (
        <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label={`${label} results`}>
          {people.map((p) => (
            <li key={p.employeeId}>
              <button type="button" onClick={() => { onChange({ id: p.employeeId, name: p.name }); setPeople([]); }} className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-secondary/70 focus-visible:bg-secondary/70 focus-visible:outline-none">
                <span className="font-medium">{p.name}</span>
                <span className="text-[13px] text-muted-foreground">{p.number}{p.department ? ` · ${p.department}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A project picker: only projects the person can see (the page was given nothing else). A filter box appears when the list is long. */
export function ProjectSelect({ label, projects, value, onChange, disabled, hint, required }: {
  label: string; projects: readonly FormProject[]; value: string; onChange: (id: string) => void; disabled?: boolean; hint?: string; required?: boolean;
}) {
  const id = useId();
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase();
    const list = t ? projects.filter((p) => `${p.reference} ${p.name}`.toLowerCase().includes(t)) : projects;
    // The chosen one always stays in the list, whatever the filter says.
    return value && !list.some((p) => p.id === value) ? [...list, ...projects.filter((p) => p.id === value)] : list;
  }, [projects, filter, value]);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium leading-none">{label}</label>
      {projects.length > 12 ? <Input aria-label={`Filter ${label.toLowerCase()}`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Type to narrow the list" disabled={disabled} /> : null}
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} required={required}>
        <option value="">{projects.length === 0 ? "No project available to you" : "Choose a project…"}</option>
        {shown.map((p) => <option key={p.id} value={p.id}>{p.reference} · {p.name}{p.status === "completed" ? " (completed)" : p.status === "on_hold" ? " (on hold)" : ""}</option>)}
      </Select>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** The request this movement is against (so it matches what was reserved). Only open requests of the chosen project or employee. */
export function RequestSelect({ label, requests, value, onChange, disabled, hint, required }: {
  label: string; requests: readonly FormRequest[]; value: string; onChange: (id: string) => void; disabled?: boolean; hint?: string; required?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium leading-none">{label}</label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} required={required}>
        <option value="">{requests.length === 0 ? "No open request" : required ? "Choose a request…" : "Not against a request"}</option>
        {requests.map((r) => <option key={r.id} value={r.id}>{r.code}{r.title ? ` · ${r.title}` : ""}</option>)}
      </Select>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
