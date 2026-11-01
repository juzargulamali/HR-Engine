"use client";

import { useState } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CONDITION_LABEL, COUNTED_CONDITIONS, SARA_ITEMS, TRANSFER_ITEMS, locName, returnOutcome, type Condition, type QueueItem, type Tracking,
} from "../_lib/inventory-concept";
import { useConceptNotice } from "./inventory-bits";
import { Chip, Field, Sheet } from "./ui";

export interface ReturnItem { key: string; name: string; sub?: string; tracking: Tracking; /** Units: 1. Counted: how many are still out. */ max: number }
export interface ReturnResult { key: string; qty: number; condition: Condition }
const UNIT_CONDITIONS: Condition[] = ["good", "fair", "needs_inspection", "damaged", "unserviceable"];

/**
 * One list for everything that comes back or arrives: a project's equipment, an employee's, a transfer's.
 * Nothing is ticked for you, nothing is assumed to have come back, and a condition has to be chosen for each thing received.
 */
export function ReturnList({ items, cameLabel, remainWord, confirmLabel, onDone, outcomeNote = true }: {
  items: ReturnItem[]; cameLabel: string; remainWord: string; confirmLabel: string; onDone: (r: ReturnResult[]) => void; outcomeNote?: boolean;
}) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [cond, setCond] = useState<Record<string, Condition | "">>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"fill" | "review" | "done">("fill");
  const [shown, setShown] = useState(false);

  const received = items.filter((i) => (i.tracking === "individual" ? ticked[i.key] : Number(qty[i.key] || 0) > 0));
  const count = (i: ReturnItem) => (i.tracking === "individual" ? 1 : Number(qty[i.key] || 0));
  const problems = received.flatMap((i) => {
    const out: string[] = [];
    if (!cond[i.key]) out.push(`Choose a condition for ${i.name}${i.sub ? ` (${i.sub})` : ""}.`);
    if (i.tracking === "counted" && (count(i) > i.max || !Number.isInteger(count(i)))) out.push(`${i.name}: ${count(i)} is more than the ${i.max} still ${remainWord}.`);
    return out;
  });
  const total = items.reduce((n, i) => n + i.max, 0);
  const receivedTotal = received.reduce((n, i) => n + count(i), 0);

  if (step === "done") {
    return (
      <div role="status" className="rounded-lg border border-success/40 bg-success/10 p-4">
        <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4 text-[hsl(var(--os-good))]" aria-hidden />Recorded: {receivedTotal} {receivedTotal === 1 ? "item" : "items"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{total - receivedTotal} {total - receivedTotal === 1 ? "item stays" : "items stay"} {remainWord}. Preview only: nothing was saved.</p>
      </div>
    );
  }

  if (step === "review") {
    const held = received.filter((i) => returnOutcome(cond[i.key] ?? "", i.tracking) === "held");
    return (
      <div className="space-y-3">
        <h3 className="font-heading text-sm font-semibold">Check before you confirm</h3>
        <ul className="divide-y divide-border/70 rounded-lg border border-border text-sm">
          {received.map((i) => {
            const o = returnOutcome(cond[i.key] as Condition, i.tracking);
            return (
              <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <span><strong>{count(i)} × {i.name}</strong>{i.sub ? <span className="text-muted-foreground"> · {i.sub}</span> : null}</span>
                <span className="flex items-center gap-2"><span>{CONDITION_LABEL[cond[i.key] as Condition]}</span>{o === "available" ? <Chip tone="good">Available again</Chip> : <Chip tone="warn">Held, not available</Chip>}</span>
              </li>
            );
          })}
        </ul>
        <p className="rounded-md bg-secondary/60 px-3 py-2 text-sm"><strong>{total - receivedTotal}</strong> {total - receivedTotal === 1 ? "item is" : "items are"} not in this entry and stay {remainWord}.{held.length ? ` ${held.length} will stay unavailable until checked.` : ""}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setStep("fill")}>Back to edit</Button>
          <Button type="button" onClick={() => { setStep("done"); onDone(received.map((i) => ({ key: i.key, qty: count(i), condition: cond[i.key] as Condition }))); }}>{confirmLabel}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border/70 rounded-lg border border-border">
        {items.map((i) => {
          const isTicked = i.tracking === "individual" ? !!ticked[i.key] : Number(qty[i.key] || 0) > 0;
          const options = i.tracking === "counted" ? COUNTED_CONDITIONS : UNIT_CONDITIONS;
          const o = returnOutcome((cond[i.key] ?? "") as Condition | "", i.tracking);
          return (
            <li key={i.key} className={cn("grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", isTicked && "bg-accent/5")}>
              <div className="flex items-start gap-3">
                {i.tracking === "individual" ? (
                  <input id={`rt-${i.key}`} type="checkbox" checked={!!ticked[i.key]} onChange={(e) => setTicked({ ...ticked, [i.key]: e.target.checked })} className="mt-1 h-5 w-5 flex-none accent-[hsl(var(--accent))]" />
                ) : null}
                <div className="min-w-0">
                  <label htmlFor={i.tracking === "individual" ? `rt-${i.key}` : `rq-${i.key}`} className="block text-sm font-medium">{i.name}{i.sub ? <span className="font-normal text-muted-foreground"> · {i.sub}</span> : null}</label>
                  <p className="text-xs text-muted-foreground">{i.tracking === "counted" ? `${i.max} still ${remainWord}` : cameLabel}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {i.tracking === "counted" ? <Input id={`rq-${i.key}`} inputMode="numeric" aria-label={`How many ${i.name} ${cameLabel.toLowerCase()}`} placeholder="How many" value={qty[i.key] ?? ""} onChange={(e) => setQty({ ...qty, [i.key]: e.target.value.replace(/[^0-9]/g, "") })} className="h-10 w-28 sm:h-9" /> : null}
                {isTicked ? (
                  <>
                    <label className="sr-only" htmlFor={`rc-${i.key}`}>Condition of {i.name}{i.sub ? ` · ${i.sub}` : ""}</label>
                    <Select id={`rc-${i.key}`} value={cond[i.key] ?? ""} onChange={(e) => setCond({ ...cond, [i.key]: e.target.value as Condition })} className="h-10 w-44 sm:h-9" aria-invalid={!cond[i.key]}>
                      <option value="">Choose condition</option>
                      {options.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                    </Select>
                    {outcomeNote && o !== "unset" ? (o === "available" ? <Chip tone="good">Available again</Chip> : <Chip tone="warn">Held</Chip>) : null}
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">Nothing is ticked for you. Tick only what is actually here. Good equipment becomes available again; damaged or unchecked equipment stays unavailable until it is checked.</p>
      {shown && problems.length ? (
        <ul role="alert" className="space-y-1 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm">
          {problems.map((p) => <li key={p} className="flex items-start gap-2"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />{p}</li>)}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={received.length === 0} onClick={() => { setShown(true); if (!problems.length) setStep("review"); }} className="h-11 w-full sm:h-9 sm:w-auto">Review {receivedTotal ? `${receivedTotal} ${receivedTotal === 1 ? "item" : "items"}` : ""}</Button>
        {received.length === 0 ? <span className="text-xs text-muted-foreground">Tick what came back to continue.</span> : null}
      </div>
    </div>
  );
}

/** The Today actions that are not a project page: a transfer, an employee's returns and a Sales check. */
export function TodaySheets({ item, onClose, onResolved }: { item: QueueItem | null; onClose: () => void; onResolved: (id: string) => void }) {
  const notify = useConceptNotice();
  const [note, setNote] = useState("");
  if (!item) return null;
  const sheet = item.action.sheet;
  const finish = (message: string) => { notify(message); onResolved(item.id); onClose(); };
  if (sheet === "employee") {
    return (
      <Sheet open onClose={onClose} title="Receive returns from Sara Khan">
        <p className="mb-3 text-sm text-muted-foreground">Dubai: Al Quoz · both items were due back today. Equipment that is not listed stays with Sara.</p>
        <ReturnList items={SARA_ITEMS.map((s) => ({ key: s.code, name: s.name, sub: s.code, tracking: s.tracking, max: 1 }))} cameLabel="Came back" remainWord="with Sara" confirmLabel="Confirm returns" onDone={() => notify("Returns recorded for Sara Khan")} />
      </Sheet>
    );
  }
  if (sheet === "transfer") {
    return (
      <Sheet open onClose={onClose} title="Receive transfer TRF-0112">
        <p className="mb-3 text-sm text-muted-foreground">From {locName("auh")} to {locName("dxb")}. Tick only what actually arrived: anything not listed stays on its way.</p>
        <ReturnList items={TRANSFER_ITEMS.map((t) => ({ key: t.code, name: t.name, sub: t.tracking === "individual" ? t.code : undefined, tracking: t.tracking, max: t.qty }))} cameLabel="Arrived" remainWord="on the way" confirmLabel="Confirm arrival" onDone={() => notify("Arrival recorded for TRF-0112")} />
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title={`Check availability for ${item.forWhom.split(" · ")[0]!.replace("Enquiry ", "")}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">You see only what Sales chose to share: the reference, the dates and the equipment asked for. No client, value or notes.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-border p-3 text-sm">
          <dt className="text-muted-foreground">Dates</dt><dd>{item.whenLabel.split("· ")[1]}</dd>
          <dt className="text-muted-foreground">Equipment</dt><dd>{item.facts[0]!.text}</dd>
        </dl>
        <Field label="Check against" htmlFor="chk-loc" required tag="(prefilled)">
          <Select id="chk-loc" defaultValue="dxb"><option value="dxb">{locName("dxb")}</option><option value="auh">{locName("auh")}</option></Select>
        </Field>
        <details className="rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Add a note for Sales (optional)</summary>
          <Textarea className="mt-2" aria-label="Note for Sales" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </details>
        <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs">The system compares the dates with live stock and tells Sales the result. You do not type the answer, and <strong>nothing is reserved</strong>.</p>
        <Button type="button" className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => finish("Availability check recorded and Sales told")}>Check availability</Button>
      </div>
    </Sheet>
  );
}
