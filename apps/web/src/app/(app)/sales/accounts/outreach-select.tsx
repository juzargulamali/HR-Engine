"use client";

import { createContext, useActionState, useContext, useState, startTransition } from "react";
import { UserPlus } from "lucide-react";
import { assignOutreach, type AssignOutreachState } from "@/lib/actions/outreach";
import { ASSIGN_RESULT_LABEL } from "@/lib/crm/clients-agencies/outreach";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { todayInDubai } from "@/components/sales/format";
import type { PersonOption } from "./account-forms";

/**
 * Multi-select on the Clients & Agencies directory and the "Assign outreach" dialog. Only a person with the assign owners right gets the checkboxes and the
 * bar (the page decides; the action and the database check the right again). The server-rendered list stays server-rendered: the provider wraps it and
 * each card renders a SelectBox.
 */
interface Selection { selected: Map<string, string>; toggle: (id: string, name: string) => void; setAll: (items: { id: string; name: string }[]) => void; clear: () => void }
const Ctx = createContext<Selection | null>(null);

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const value: Selection = {
    selected,
    toggle: (id, name) => setSelected((prev) => { const next = new Map(prev); if (next.has(id)) next.delete(id); else next.set(id, name); return next; }),
    setAll: (items) => setSelected(new Map(items.map((i) => [i.id, i.name]))),
    clear: () => setSelected(new Map()),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function SelectBox({ id, name }: { id: string; name: string }) {
  const s = useContext(Ctx);
  if (!s) return null;
  return (
    <input
      type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={s.selected.has(id)} onChange={() => s.toggle(id, name)}
      aria-label={`Select ${name} for outreach`}
    />
  );
}

export function AssignBar({ companyId, shown, people }: { companyId: string; shown: { id: string; name: string }[]; people: PersonOption[] }) {
  const s = useContext(Ctx);
  const [open, setOpen] = useState(false);
  if (!s) return null;
  const n = s.selected.size;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm" role="region" aria-label="Assign outreach">
      <span role="status" className="font-medium">{n === 0 ? "No accounts selected" : `${n} ${n === 1 ? "account" : "accounts"} selected`}</span>
      <Button type="button" variant="ghost" size="sm" onClick={() => s.setAll(shown)}>Select all shown ({shown.length})</Button>
      {n > 0 ? <Button type="button" variant="ghost" size="sm" onClick={s.clear}>Clear selection</Button> : null}
      <Button type="button" size="sm" disabled={n === 0} onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" aria-hidden /> Assign outreach</Button>
      {/* Mounted only while open, so each opening starts with a fresh form and no earlier result. */}
      {open ? <AssignDialog onClose={() => setOpen(false)} companyId={companyId} people={people} selected={s.selected} onDone={s.clear} /> : null}
    </div>
  );
}

function AssignDialog({ onClose, companyId, people, selected, onDone }: { onClose: () => void; companyId: string; people: PersonOption[]; selected: Map<string, string>; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<AssignOutreachState, FormData>(assignOutreach, { error: null });
  const done = state.results ?? null;
  const names = new Map(selected);
  const close = onClose;
  return (
    <Modal open onClose={close} title="Assign outreach" description="Give the selected accounts to a salesperson to approach or re-engage, with a target date. No inquiry is needed or created, and the account owner does not change.">
      {done ? (
        <div className="space-y-3">
          <ul className="divide-y divide-border text-sm" aria-label="Result for each account">
            {done.map((r) => <li key={r.organisation_id} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="font-medium">{names.get(r.organisation_id) ?? "Account"}</span><span data-result={r.result}>{ASSIGN_RESULT_LABEL[r.result] ?? r.result}</span></li>)}
          </ul>
          <div className="flex justify-end"><Button type="button" onClick={() => { onDone(); close(); }}>Done</Button></div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (pending) return;
            const data = new FormData(e.currentTarget);
            startTransition(async () => { formAction(data); });
          }}
        >
          <input type="hidden" name="companyId" value={companyId} />
          {[...selected.keys()].map((id) => <input key={id} type="hidden" name="orgId" value={id} />)}
          <p className="text-sm text-muted-foreground">{selected.size} {selected.size === 1 ? "account" : "accounts"}: {[...selected.values()].slice(0, 5).join(", ")}{selected.size > 5 ? `, and ${selected.size - 5} more` : ""}</p>
          <Field label="Assign to" htmlFor="oa-who" hint="Only people with Sales access for this company are listed.">
            <Select id="oa-who" name="assigneeId" required defaultValue="">
              <option value="" disabled>Choose a salesperson…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Target date" htmlFor="oa-target" hint="When the first approach should have happened."><Input id="oa-target" name="target" type="date" required defaultValue={todayInDubai()} /></Field>
          <Field label="Objective (optional)" htmlFor="oa-objective" hint="For example “Reconnect and ask about upcoming exhibitions”."><Textarea id="oa-objective" name="objective" rows={2} maxLength={500} /></Field>
          <p className="text-sm text-muted-foreground">An account that already has open outreach is handed to this person instead (its history stays); one that already has it for this person is left as it is.</p>
          {state.error ? <Alert variant="destructive" role="alert">{state.error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Assigning…" : "Assign outreach"}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
