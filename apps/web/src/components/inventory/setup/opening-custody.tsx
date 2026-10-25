"use client";

import { useState, useTransition } from "react";
import { confirmInventoryOpeningCustody, lookupInventoryEmployees } from "@/lib/actions/inventorySetup";
import type { InvActionState } from "@/lib/inventory/action-utils";
import { newMovementKey } from "@/lib/inventory/idempotency";
import { BALANCE_CONDITION_WORDS, formatQty, LIFECYCLE_WORDS } from "@/lib/inventory/words";
import { parseCountedQty } from "@/lib/inventory/setup";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";

export interface CustodyUnit { id: string; code: string; itemName: string; holderKind: "employee" | "project"; holderName: string | null }
export interface QtyItem { id: string; name: string; scale: number; unitOfMeasure: string }
interface QtyLine { itemId: string; itemName: string; qty: number; unit: string; condition: string; holderKind: "employee" | "project"; holderId: string; holderName: string }

/**
 * "Record equipment already with employees or on projects". A unit is in one place only: what is already out is confirmed here and never
 * counted on a shelf, so nothing is counted twice. The database refuses anything already verified or recorded elsewhere and says which.
 */
export function OpeningCustody({ companyId, units, items, projects, canConfirm }: { companyId: string; units: readonly CustodyUnit[]; items: readonly QtyItem[]; projects: readonly { id: string; name: string }[]; canConfirm: boolean }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [lines, setLines] = useState<QtyLine[]>([]);
  const [draft, setDraft] = useState({ itemId: "", qty: "", condition: "good", holderKind: "employee" as "employee" | "project", projectId: "", query: "", employeeId: "", employeeName: "" });
  const [found, setFound] = useState<{ id: string; name: string; number: string; department: string | null }[]>([]);
  const [lineError, setLineError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [searchError, setSearchError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const toggle = (id: string, on: boolean) => setTicked((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  const allTicked = units.length > 0 && ticked.size === units.length;

  function search() {
    setSearchError(null);
    startSearch(async () => {
      const r = await lookupInventoryEmployees(companyId, draft.query);
      setFound(r.people);
      if (r.error) setSearchError(r.error);
      else if (draft.query.trim().length >= 2 && r.people.length === 0) setSearchError("No active employee matches that.");
    });
  }
  function addLine() {
    setLineError(null);
    const item = items.find((i) => i.id === draft.itemId);
    if (!item) return setLineError("Choose the item.");
    const q = parseCountedQty(draft.qty, item.scale, "opening");
    if (!q.ok) return setLineError(q.error);
    if (draft.holderKind === "employee" && !draft.employeeId) return setLineError("Search for the employee and choose them.");
    if (draft.holderKind === "project" && !draft.projectId) return setLineError("Choose the project.");
    const project = projects.find((p) => p.id === draft.projectId);
    setLines((l) => [...l, {
      itemId: item.id, itemName: item.name, qty: q.value, unit: item.unitOfMeasure, condition: draft.condition, holderKind: draft.holderKind,
      holderId: draft.holderKind === "employee" ? draft.employeeId : draft.projectId, holderName: draft.holderKind === "employee" ? draft.employeeName : (project?.name ?? "Project"),
    }]);
    setDraft((d) => ({ ...d, qty: "", itemId: "" }));
  }

  const payload = JSON.stringify([
    ...[...ticked].map((id) => ({ unit_id: id })),
    ...lines.map((l) => ({ item_id: l.itemId, qty: l.qty, condition: l.condition, ...(l.holderKind === "employee" ? { employee_id: l.holderId } : { project_id: l.holderId }) })),
  ]);
  const count = ticked.size + lines.length;
  // One key per distinct list: a retry of the SAME list can never record twice; a changed list is a new request.
  const [issued, setIssued] = useState(() => ({ payload, key: newMovementKey("custody") }));
  if (issued.payload !== payload) setIssued({ payload, key: newMovementKey("custody") });

  return (
    <div className="space-y-4">
      <Alert role="status">
        <p className="font-medium">A unit can only be in one place.</p>
        <p className="mt-1">Equipment that is already with an employee or on a project is confirmed here, once. It is never counted on a shelf as well, so it is never counted twice. If a unit or quantity is already verified, or is recorded somewhere else, the database refuses it and tells you which one.</p>
      </Alert>
      <p className="max-w-3xl text-sm text-muted-foreground">Equipment is registered first (from the catalogue, with who holds it now) and stays marked <strong>Not counted yet</strong> until it is confirmed. Imported items from the earlier HR asset register that are with employees appear here too.</p>

      {units.length === 0 ? <p className="text-sm text-muted-foreground">No registered units are waiting to be confirmed as held by an employee or on a project.</p> : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4" checked={allTicked} disabled={!canConfirm} onChange={(e) => setTicked(e.target.checked ? new Set(units.map((u) => u.id)) : new Set())} /> Select all ({units.length})</label>
          <ul className="divide-y divide-border rounded-md border border-border">
            {units.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <label className="flex min-w-0 items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={ticked.has(u.id)} disabled={!canConfirm} onChange={(e) => toggle(u.id, e.target.checked)} />
                  <span className="min-w-0"><span className="font-medium">{u.code}</span> <span className="text-muted-foreground">· {u.itemName}</span><span className="block text-muted-foreground">{u.holderKind === "employee" ? "With" : "On project"}: {u.holderName ?? (u.holderKind === "employee" ? "an employee" : "a project")}</span></span>
                </label>
                <Badge variant="warning">{LIFECYCLE_WORDS.draft}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canConfirm ? (
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">Add a counted quantity held by an employee or a project</summary>
          <div className="space-y-3 border-t border-border p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Item" htmlFor="oc-item" className="space-y-1.5 sm:col-span-2"><Select id="oc-item" value={draft.itemId} onChange={(e) => setDraft({ ...draft, itemId: e.target.value })}><option value="">Choose an item…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></Field>
              <Field label="Quantity" htmlFor="oc-qty"><Input id="oc-qty" inputMode="decimal" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} placeholder="Type the number" autoComplete="off" /></Field>
            </div>
            <Field label="Condition" htmlFor="oc-cond"><Select id="oc-cond" value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value })} className="max-w-xs">{Object.entries(BALANCE_CONDITION_WORDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Held by</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="oc-holder" checked={draft.holderKind === "employee"} onChange={() => setDraft({ ...draft, holderKind: "employee" })} /> An employee</label>
                <label className="flex items-center gap-2"><input type="radio" name="oc-holder" checked={draft.holderKind === "project"} onChange={() => setDraft({ ...draft, holderKind: "project" })} /> A project</label>
              </div>
              {draft.holderKind === "employee" ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[12rem] flex-1"><label htmlFor="oc-emp" className="mb-1 block text-sm font-medium leading-none">Find the employee</label><Input id="oc-emp" type="search" value={draft.query} onChange={(e) => setDraft({ ...draft, query: e.target.value, employeeId: "", employeeName: "" })} placeholder="Name or employee number" autoComplete="off" /></div>
                    <Button type="button" variant="secondary" disabled={draft.query.trim().length < 2 || searching} onClick={search}>{searching ? "Searching…" : "Search"}</Button>
                  </div>
                  {searchError ? <p className="text-sm text-muted-foreground" role="status">{searchError}</p> : null}
                  {found.length > 0 ? (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {found.map((p) => <li key={p.id}><label className="flex items-start gap-2 px-3 py-2 text-sm"><input type="radio" name="oc-emp-pick" className="mt-0.5" checked={draft.employeeId === p.id} onChange={() => setDraft({ ...draft, employeeId: p.id, employeeName: p.name })} /><span><span className="font-medium">{p.name}</span> <span className="text-muted-foreground">· {p.number}{p.department ? ` · ${p.department}` : ""}</span></span></label></li>)}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <Field label="Project" htmlFor="oc-proj"><Select id="oc-proj" value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}><option value="">{projects.length === 0 ? "No project is available to you" : "Choose a project…"}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              )}
            </fieldset>
            {lineError ? <Alert variant="destructive" role="alert">{lineError}</Alert> : null}
            <Button type="button" variant="outline" size="sm" onClick={addLine}>Add to the list</Button>
          </div>
        </details>
      ) : null}

      {lines.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border" aria-label="Quantities to confirm">
          {lines.map((l, i) => (
            <li key={`${l.itemId}-${l.holderId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span><span className="font-medium">{formatQty(l.qty, l.unit)} × {l.itemName}</span> <span className="text-muted-foreground">· {l.holderKind === "employee" ? "with" : "on"} {l.holderName}</span></span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setLines((x) => x.filter((_, j) => j !== i))}>Remove<span className="sr-only">{` ${l.itemName}`}</span></Button>
            </li>
          ))}
        </ul>
      ) : null}

      {canConfirm ? (
        result ? <Alert variant="success" role="status">Confirmed{typeof result.units === "number" ? `: ${result.units} ${result.units === 1 ? "unit" : "units"}` : ""}{typeof result.quantity_lines === "number" && result.quantity_lines > 0 ? `, ${result.quantity_lines} ${result.quantity_lines === 1 ? "quantity" : "quantities"}` : ""}. {result.replayed === true ? "This was already confirmed earlier; nothing was recorded twice." : ""}</Alert> : (
          <ActionForm action={confirmInventoryOpeningCustody} submitLabel={count === 0 ? "Confirm" : `Confirm ${count} ${count === 1 ? "line" : "lines"}`} pendingLabel="Confirming…" onDone={(s) => { setResult(((s as InvActionState).detail as Record<string, unknown> | undefined) ?? {}); setTicked(new Set()); setLines([]); }}>
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="key" value={issued.key} />
            <input type="hidden" name="lines" value={payload} />
            <Field label="Note (optional)" htmlFor="oc-note"><Textarea id="oc-note" name="note" rows={2} maxLength={300} /></Field>
            {count === 0 ? <p className="text-sm text-muted-foreground">Tick the units, or add a quantity, then confirm. Your name and the time are recorded as the verification.</p> : null}
          </ActionForm>
        )
      ) : <Alert role="status">Only a founder, or someone allowed to confirm stock counts, can confirm equipment held by employees or on projects.</Alert>}
    </div>
  );
}
