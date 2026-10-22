"use client";

import { useMemo, useState } from "react";
import { addRequestLine, expandTechnology } from "@/lib/actions/inventoryPlanning";
import { expandChoices, formatQtyPlain, templateSlots } from "@/lib/inventory/planning";
import type { TechnologyOption } from "@/lib/inventory/planning-data";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, InvForm } from "./inv-form";
import { ItemPicker } from "./pickers";

/** Add one catalogue item to the request. The item is chosen from the list (search by name or model), never typed free. */
export function AddLineForm({ requestId, companyId, projectId }: { requestId: string; companyId: string; projectId?: string | null }) {
  const [round, setRound] = useState(0);
  return (
    <InvForm action={addRequestLine} submitLabel="Add line" pendingLabel="Adding…" onDone={() => setRound((n) => n + 1)} resetOnSuccess>
      <input type="hidden" name="requestId" value={requestId} />
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <ItemPicker key={round} companyId={companyId} />
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Field label="Quantity" htmlFor={`add-qty-${requestId}`}>
          <Input id={`add-qty-${requestId}`} name="qty" type="number" inputMode="decimal" min="0" step="any" defaultValue="1" required />
        </Field>
        <Field label="Note (optional)" htmlFor={`add-note-${requestId}`}>
          <Input id={`add-note-${requestId}`} name="note" maxLength={300} />
        </Field>
      </div>
    </InvForm>
  );
}

/**
 * "Add from a technology template": the template's components times a number become request lines. The lines are a snapshot, so
 * later edits to the template never reach them, and the quantities can be changed afterwards. Where a template lists alternatives for
 * a slot you can start with one; choosing a non-standard one adds it as a substitute that is not yet accepted.
 */
export function TechnologyForm({ requestId, technologies, projectId }: { requestId: string; technologies: TechnologyOption[]; projectId?: string | null }) {
  const [techId, setTechId] = useState("");
  const [multiplier, setMultiplier] = useState("1");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const tech = technologies.find((t) => t.id === techId) ?? null;
  const slots = useMemo(() => (tech ? templateSlots(tech.components, (id) => tech.itemNames[id] ?? "Item") : []), [tech]);
  const choices = tech ? expandChoices(slots, selection) : {};
  const groups = slots.filter((s) => s.altGroup && s.options.length > 1);

  if (technologies.length === 0) return <p className="text-sm text-muted-foreground">There are no complete technology templates for this company yet. A catalogue manager prepares them under Setup.</p>;
  return (
    <InvForm action={expandTechnology} submitLabel="Add the template's lines" pendingLabel="Adding…">
      <input type="hidden" name="requestId" value={requestId} />
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <input type="hidden" name="technologyName" value={tech?.name ?? ""} />
      <input type="hidden" name="choices" value={JSON.stringify(choices)} />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <Field label="Technology template" htmlFor={`tech-${requestId}`}>
          <Select id={`tech-${requestId}`} name="technologyId" value={techId} onChange={(e) => { setTechId(e.target.value); setSelection({}); }} required>
            <option value="">Choose a template</option>
            {technologies.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="How many" htmlFor={`mult-${requestId}`}>
          <Input id={`mult-${requestId}`} name="multiplier" type="number" inputMode="decimal" min="0" step="any" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} required />
        </Field>
      </div>
      {tech ? (
        <>
          <ul className="space-y-0.5 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
            {slots.map((s) => s.options[0] ? (
              <li key={s.key} className="flex flex-wrap justify-between gap-x-3">
                <span className="min-w-0 break-words">{s.options[0].name}{s.options.length > 1 ? <span className="text-muted-foreground"> (or an alternative)</span> : null}{s.optional ? <span className="text-muted-foreground"> · optional</span> : null}</span>
                <span className="tabular-nums text-muted-foreground">× {formatQtyPlain(s.options[0].qty * (Number(multiplier) || 0))}</span>
              </li>
            ) : null)}
          </ul>
          {groups.map((g) => (
            <Field key={g.key} label={`Alternatives for “${g.altGroup}”`} htmlFor={`alt-${requestId}-${g.key}`} hint="Starting with a listed alternative adds it as a substitute that is not yet accepted.">
              <Select id={`alt-${requestId}-${g.key}`} value={selection[g.altGroup as string] ?? g.options[0]?.itemId} onChange={(e) => setSelection((s) => ({ ...s, [g.altGroup as string]: e.target.value }))}>
                {g.options.map((o, i) => <option key={o.itemId} value={o.itemId}>{i === 0 ? `Standard: ${o.name}` : `Alternative: ${o.name}`}</option>)}
              </Select>
            </Field>
          ))}
        </>
      ) : null}
      <p className="text-sm text-muted-foreground">The lines are a snapshot of the template today. Changing the template later does not change them, and you can adjust the quantities afterwards.</p>
    </InvForm>
  );
}
