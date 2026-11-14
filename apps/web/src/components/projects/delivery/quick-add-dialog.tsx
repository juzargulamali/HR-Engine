"use client";

import { useRef, useState } from "react";
import { addPlanLines } from "@/lib/actions/projectsDeliveryPlan";
import { ActionForm } from "@/components/sales/action-form";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DP_SECTION_LABELS, type DpSection } from "@/lib/projects/delivery-plan/model";
import { parseQuickRows, QUICK_ADD_MAX } from "@/lib/projects/delivery-plan/ordering";
import { FormDialog, type Done, type Option } from "@/components/projects/delivery/delivery-forms";

type Row = { id: number; name: string; qty: string; owner: string; start: string; due: string };
const START_ROWS = 5;

/**
 * Quick add: type or paste a list and save it in one go. Each row is one requirement of the chosen section; names are required, the rest optional. It uses the same save path
 * as adding one requirement (same permission, same validation, same-name-is-the-same-line), so pressing Add rows twice, reloading and pressing it again, or a dropped
 * connection never adds a row twice: rows that already exist are reported and left as they are. One refused row refuses the whole list and names it.
 */
export function QuickAddDialog({ projectId, itemId, sections, members, milestones, activationOwner }: {
  projectId: string; itemId: string; sections: DpSection[]; members: Option[]; milestones: Option[]; activationOwner?: string | null;
}) {
  const next = useRef(START_ROWS);
  const blank = (): Row => ({ id: next.current++, name: "", qty: "", owner: "", start: "", due: "" });
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: START_ROWS }, (_, id) => ({ id, name: "", qty: "", owner: "", start: "", due: "" })));
  const [section, setSection] = useState<DpSection>(sections[0] ?? "hardware");
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const hardware = section === "hardware";
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const set = (id: number, patch: Partial<Row>) => setRows((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const defaultOwner = hardware ? "No owner" : `Use activation owner${activationOwner ? ` (${activationOwner})` : " (none set yet)"}`;

  const addPasted = () => {
    const { rows: parsed, skipped, truncated } = parseQuickRows(paste);
    if (parsed.length === 0) { setNote("Nothing to add: put one requirement on each line."); return; }
    setRows((all) => {
      const kept = all.filter((r) => r.name.trim() || r.qty || r.owner || r.start || r.due);          // keep what was typed; drop the empty rows the list replaces
      const merged = [...kept, ...parsed.map((p) => ({ ...blank(), name: p.name, qty: p.qty }))].slice(0, QUICK_ADD_MAX);
      return merged;
    });
    setPaste("");
    setNote(`${parsed.length} row${parsed.length === 1 ? "" : "s"} added below${skipped ? `; ${skipped} skipped` : ""}${truncated ? `; only the first ${QUICK_ADD_MAX} are kept` : ""}. Check them, then press Add rows.`);
  };

  return (
    <FormDialog label="Quick add" title="Add several requirements at once" dialogSize="xl" testId="dp-quick-add"
      description="Nothing is released until the Project Manager releases it."
      help="Type or paste a list, one requirement per row. Rows already in the plan are never added twice, so saving again is safe.">
      {(done) => (
        <ActionForm action={addPlanLines} submitLabel="Add rows" pendingLabel="Adding…" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="itemId" value={itemId} />
          {sections.length > 1 ? (
            <div className="max-w-xs">
              <label htmlFor="qa-section" className="mb-1 block text-[13px] font-medium text-muted-foreground">Section</label>
              <Select id="qa-section" name="section" value={section} onChange={(e) => setSection(e.target.value as DpSection)}>
                {sections.map((s) => <option key={s} value={s}>{DP_SECTION_LABELS[s]}</option>)}
              </Select>
            </div>
          ) : <input type="hidden" name="section" value={section} />}
          {sections.length === 1 ? <p className="text-[13px] text-muted-foreground">Section: {DP_SECTION_LABELS[section]}</p> : null}

          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">Paste a list</summary>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-1 text-[13px] text-muted-foreground"><label htmlFor="qa-paste">One requirement per line</label><InfoHint label="pasting a list">A quantity can follow a tab (copy two columns from Excel), or be written “Batak unit x 4” or “4 x Batak unit”.</InfoHint></div>
              <Textarea id="qa-paste" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Batak unit\t4\nPower distribution box x 2"} />
              <Button type="button" variant="outline" size="sm" onClick={addPasted} disabled={!paste.trim()}>Put these in the rows below</Button>
            </div>
          </details>
          {note ? <p role="status" className="text-[13px]" data-testid="qa-note">{note}</p> : null}

          <div role="table" aria-label="Rows to add" className="space-y-2">
            <div role="row" className={`hidden gap-2 px-1 text-[12px] font-semibold text-muted-foreground md:grid ${hardware ? "md:grid-cols-[2rem_minmax(0,3fr)_5rem_minmax(0,2fr)_8.5rem_8.5rem_4.5rem]" : "md:grid-cols-[2rem_minmax(0,3fr)_minmax(0,2fr)_8.5rem_8.5rem_4.5rem]"}`}>
              <span role="columnheader" /><span role="columnheader">Name</span>{hardware ? <span role="columnheader">Qty</span> : null}<span role="columnheader">Owner</span><span role="columnheader">Start</span><span role="columnheader">Due</span><span role="columnheader" />
            </div>
            {rows.map((r, n) => (
              <div key={r.id} role="row" data-testid={`qa-row-${n}`}
                className={`grid grid-cols-1 items-start gap-2 rounded-md border border-border p-2 md:border-0 md:p-0 ${hardware ? "md:grid-cols-[2rem_minmax(0,3fr)_5rem_minmax(0,2fr)_8.5rem_8.5rem_4.5rem]" : "md:grid-cols-[2rem_minmax(0,3fr)_minmax(0,2fr)_8.5rem_8.5rem_4.5rem]"}`}>
                <span role="cell" className="hidden pt-2 text-center text-[12px] text-muted-foreground md:block">{n + 1}</span>
                <div role="cell" className="min-w-0"><label htmlFor={`qa-name-${r.id}`} className="mb-0.5 block text-[12px] font-medium text-muted-foreground md:sr-only">Row {n + 1} name</label>
                  <Input id={`qa-name-${r.id}`} name="rowName" aria-label={`Row ${n + 1} name`} value={r.name} maxLength={300} onChange={(e) => set(r.id, { name: e.target.value })} className="w-full" /></div>
                {hardware ? (
                  <div role="cell" className="min-w-0"><label htmlFor={`qa-qty-${r.id}`} className="mb-0.5 block text-[12px] font-medium text-muted-foreground md:sr-only">Row {n + 1} quantity</label>
                    <Input id={`qa-qty-${r.id}`} name="rowQty" aria-label={`Row ${n + 1} quantity`} type="number" min="0.001" step="any" inputMode="decimal" value={r.qty} onChange={(e) => set(r.id, { qty: e.target.value })} className="w-full" /></div>
                ) : <input type="hidden" name="rowQty" value="" />}
                <div role="cell" className="min-w-0"><label htmlFor={`qa-owner-${r.id}`} className="mb-0.5 block text-[12px] font-medium text-muted-foreground md:sr-only">Row {n + 1} owner</label>
                  <Select id={`qa-owner-${r.id}`} name="rowOwner" aria-label={`Row ${n + 1} owner`} value={r.owner} onChange={(e) => set(r.id, { owner: e.target.value })} className="w-full min-w-0">
                    <option value="">{defaultOwner}</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                  {r.owner ? <p className="mt-0.5 break-words text-[12px]" data-testid={`qa-owner-name-${n}`}>Assigned to {memberName.get(r.owner) ?? "the person chosen"}</p> : null}</div>
                <div role="cell" className="min-w-0"><label htmlFor={`qa-start-${r.id}`} className="mb-0.5 block text-[12px] font-medium text-muted-foreground md:sr-only">Row {n + 1} start date</label>
                  <Input id={`qa-start-${r.id}`} name="rowStart" aria-label={`Row ${n + 1} start`} type="date" value={r.start} onChange={(e) => set(r.id, { start: e.target.value })} className="w-full" /></div>
                <div role="cell" className="min-w-0"><label htmlFor={`qa-due-${r.id}`} className="mb-0.5 block text-[12px] font-medium text-muted-foreground md:sr-only">Row {n + 1} due date</label>
                  <Input id={`qa-due-${r.id}`} name="rowDue" aria-label={`Row ${n + 1} due`} type="date" value={r.due} onChange={(e) => set(r.id, { due: e.target.value })} className="w-full" /></div>
                <div role="cell"><Button type="button" variant="ghost" size="sm" onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))} aria-label={`Remove row ${n + 1}`}>Remove</Button></div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {rows.length < QUICK_ADD_MAX ? <Button type="button" variant="outline" size="sm" onClick={() => setRows((all) => [...all, blank()])}>Add a row</Button> : <span className="text-[13px] text-muted-foreground">That is the {QUICK_ADD_MAX}-row limit; save these, then add more.</span>}
            {!hardware ? (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="chain" className="h-4 w-4" /> Each row waits for the one above (a sequence)</label>
            ) : null}
          </div>
          {milestones.length > 0 ? (
            <div className="max-w-sm">
              <label htmlFor="qa-ms" className="mb-1 block text-[13px] font-medium text-muted-foreground">Milestone for all rows (optional)</label>
              <Select id="qa-ms" name="milestoneId" defaultValue=""><option value="">None</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            </div>
          ) : null}
        </ActionForm>
      )}
    </FormDialog>
  );
}
