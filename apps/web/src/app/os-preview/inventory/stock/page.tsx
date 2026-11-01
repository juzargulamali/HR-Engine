"use client";

import { useState } from "react";
import { CheckCircle2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { STOCK, locName, type LocId, type StockRow } from "../../_lib/inventory-concept";
import { InventoryFrame, useConceptNotice, useLoc } from "../../_components/inventory-bits";
import { ActionMenu, Chip, Field, Hint, Sheet, StateGate } from "../../_components/ui";

const BINS = ["No bin", "A1", "A2", "B1", "C1"];

function ReceiveSheet({ loc, start, onClose }: { loc: LocId; start: StockRow | null; onClose: () => void }) {
  const notify = useConceptNotice();
  const [step, setStep] = useState(start ? 2 : 1);
  const [q, setQ] = useState("");
  const [item, setItem] = useState<StockRow | null>(start);
  const [qty, setQty] = useState("");
  const [serials, setSerials] = useState("");
  const [bin, setBin] = useState("No bin");
  const [cond, setCond] = useState("good");
  const [note, setNote] = useState("");
  const [rented, setRented] = useState(false);
  const [done, setDone] = useState(false);
  const matches = STOCK.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) || s.sku.toLowerCase().includes(q.toLowerCase()));
  const serialList = serials.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const n = serialList.length > 0 ? serialList.length : Number(qty || 0);
  const qtyProblem = serialList.length > 0 && qty && Number(qty) !== serialList.length ? `You typed ${serialList.length} serial numbers but a quantity of ${qty}. Make them match, or clear one.` : null;
  const canNext = step === 1 ? !!item : step === 2 ? n > 0 && !qtyProblem : true;
  const total = 4;

  if (done && item) {
    return (
      <Sheet open onClose={onClose} title="Receive stock">
        <div role="status" className="rounded-lg border border-success/40 bg-success/10 p-4">
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4 text-[hsl(var(--os-good))]" aria-hidden />Recorded: {n} × {item.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">Received into {locName(loc)}{bin !== "No bin" ? `, bin ${bin}` : ""}. Preview only: nothing was saved.</p>
          {item.tracking === "individual" ? <p className="mt-1 text-sm text-muted-foreground">Each unit gets its own code and label.</p> : null}
        </div>
        <div className="mt-4 flex gap-2"><Button type="button" variant="outline" onClick={() => { setDone(false); setItem(null); setQty(""); setSerials(""); setStep(1); }}>Receive another</Button><Button type="button" onClick={onClose}>Done</Button></div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title="Receive stock">
      <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">Step {step} of {total}: {["What arrived", "How many", "Where it goes", "Check and confirm"][step - 1]}</p>
      <div className="space-y-4">
        {step === 1 ? (
          <div>
            <label htmlFor="rx-search" className="mb-1 block text-sm font-medium">Find the equipment</label>
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input id="rx-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, model or code" className="h-11 pl-9 sm:h-9" autoComplete="off" /></div>
            <ul className="mt-2 max-h-64 divide-y divide-border/70 overflow-y-auto rounded-lg border border-border">
              {matches.map((s) => (
                <li key={s.id}><button type="button" onClick={() => setItem(s)} aria-pressed={item?.id === s.id} className={cn("flex w-full items-center justify-between gap-2 px-3 py-3 text-left text-sm hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-2.5", item?.id === s.id && "bg-accent/10 font-semibold")}>{s.name}<span className="text-xs text-muted-foreground">{s.sku}</span></button></li>
              ))}
              {matches.length === 0 ? <li className="px-3 py-3 text-sm text-muted-foreground">Nothing matches. New equipment types are added under Manage → Catalogue.</li> : null}
            </ul>
          </div>
        ) : null}
        {step === 2 && item ? (
          <div className="space-y-3">
            <p className="text-sm"><strong>{item.name}</strong></p>
            <Field label={item.tracking === "individual" ? "How many arrived" : `How many ${item.unit ?? "units"} arrived`} htmlFor="rx-qty" required tag="(count them)" error={qtyProblem}>
              <Input id="rx-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))} className="h-11 w-40 text-base sm:h-9 sm:text-sm" />
            </Field>
            {item.tracking === "individual" ? (
              <details className="rounded-md border border-border px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium">I have serial numbers (optional)</summary>
                <Textarea className="mt-2" aria-label="Serial numbers" placeholder="One per line. Each unit gets its own equipment code." value={serials} onChange={(e) => setSerials(e.target.value)} />
              </details>
            ) : null}
          </div>
        ) : null}
        {step === 3 ? (
          <div className="space-y-3">
            <Field label="Received into" htmlFor="rx-loc" required tag="(your warehouse)"><Select id="rx-loc" value={loc} disabled><option value={loc}>{locName(loc)}</option></Select></Field>
            <Field label="Shelf or bin" htmlFor="rx-bin" tag="(optional)"><Select id="rx-bin" value={bin} onChange={(e) => setBin(e.target.value)}>{BINS.map((b) => <option key={b}>{b}</option>)}</Select></Field>
            <details className="rounded-md border border-border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">More details</summary>
              <div className="mt-3 space-y-3">
                <Field label="Condition" htmlFor="rx-cond" tag="(good unless you say otherwise)"><Select id="rx-cond" value={cond} onChange={(e) => setCond(e.target.value)}><option value="good">Good</option><option value="needs_inspection">Needs checking</option><option value="damaged">Damaged</option></Select></Field>
                <Field label="Note" htmlFor="rx-note" tag="(optional)"><Textarea id="rx-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <label className="flex items-center gap-2"><input type="checkbox" checked={rented} onChange={(e) => setRented(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--accent))]" />This is rented, not owned</label>
              </div>
            </details>
          </div>
        ) : null}
        {step === 4 && item ? (
          <div className="space-y-3">
            <h3 className="font-heading text-sm font-semibold">Check before you confirm</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-border p-3 text-sm">
              <dt className="text-muted-foreground">What</dt><dd className="font-medium">{item.name}</dd>
              <dt className="text-muted-foreground">How many</dt><dd>{n}{serialList.length ? ` (serial numbers entered)` : ""}</dd>
              <dt className="text-muted-foreground">Into</dt><dd>{locName(loc)}{bin !== "No bin" ? `, bin ${bin}` : ""}</dd>
              <dt className="text-muted-foreground">Condition</dt><dd>{cond === "good" ? "Good" : cond === "damaged" ? "Damaged, held back" : "Needs checking, held back"}{rented ? " · rented" : ""}</dd>
              {note ? <><dt className="text-muted-foreground">Note</dt><dd>{note}</dd></> : null}
            </dl>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => (step === 1 || (start && step === 2) ? onClose() : setStep(step - 1))}>{step === 1 || (start && step === 2) ? "Cancel" : "Back"}</Button>
          {step < total ? <Button type="button" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</Button> : <Button type="button" onClick={() => { setDone(true); notify(`Received ${n} × ${item?.name}`); }}>Confirm: receive {n}</Button>}
        </div>
      </div>
    </Sheet>
  );
}

function RowActions({ s, onReceive }: { s: StockRow; onReceive: () => void }) {
  const notify = useConceptNotice();
  return (
    <div className="flex items-center gap-1.5 md:justify-end">
      <Button type="button" size="sm" onClick={onReceive} className="h-10 md:h-8">Receive</Button>
      <ActionMenu label="More" items={[
        { label: "Open details", onSelect: () => notify(`Would open ${s.name} in a side panel, keeping this list and your place in it`) },
        { label: "Check availability", onSelect: () => notify(`Would open the availability check for ${s.name}`) },
        { label: "Send out", onSelect: () => notify(`Would start Send out with ${s.name}`) },
      ]} />
    </div>
  );
}

export default function Stock() {
  const { loc } = useLoc();
  const [q, setQ] = useState("");
  const [receive, setReceive] = useState<{ start: StockRow | null } | null>(null);
  const rows = STOCK.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) || s.sku.toLowerCase().includes(q.toLowerCase()));
  return (
    <InventoryFrame
      section="stock" title="Stock" description={`What is at ${locName(loc)}: search, scan, look at equipment, receive new stock.`}
      actions={<Button type="button" onClick={() => setReceive({ start: null })} className="h-11 sm:h-9">Receive stock</Button>}
    >
      <StateGate what="stock" emptyTitle="No equipment in the catalogue yet" emptyText="Add equipment types under Manage → Catalogue first." deniedWho="Your account can see the catalogue but not stock at this warehouse.">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><label htmlFor="stock-q" className="sr-only">Search equipment</label><Input id="stock-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, model or code" className="h-11 pl-9 sm:h-9" /></div>
          <p className="text-xs text-muted-foreground">Showing {rows.length} of {STOCK.length} equipment types</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="hidden grid-cols-[minmax(0,2fr)_8rem_6rem_6rem_minmax(0,1.3fr)] gap-3 border-b border-border bg-secondary/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
            <span>Equipment</span><span className="text-right">Available here</span><span className="text-right">Out</span><span className="text-right">Reserved</span><span className="text-right">Action</span>
          </div>
          {rows.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No equipment matches “{q}”.</p> : (
            <ul className="divide-y divide-border/70">
              {rows.map((s) => (
                <li key={s.id} className="grid gap-x-3 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,2fr)_8rem_6rem_6rem_minmax(0,1.3fr)] md:items-center">
                  <div className="min-w-0"><p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.sku} · {s.tracking === "individual" ? "individual units" : `counted (${s.unit})`}</p></div>
                  <p className="md:text-right"><span className="text-xs text-muted-foreground md:hidden">Available here </span><span className={cn("font-semibold", s.available[loc] === 0 && "text-warning")}>{s.available[loc]}</span></p>
                  <p className="md:text-right"><span className="text-xs text-muted-foreground md:hidden">Out </span>{s.out[loc] === null ? <span className="inline-flex items-center gap-0.5"><span aria-label="Not split by warehouse">—</span><Hint text={s.outNote ?? ""} label="Why is Out not shown?" align="right" /></span> : s.out[loc]}</p>
                  <p className="md:text-right"><span className="text-xs text-muted-foreground md:hidden">Reserved </span>{s.reserved[loc]}</p>
                  <RowActions s={s} onReceive={() => setReceive({ start: s })} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground"><Chip>—</Chip> Counted stock that is out with people or on projects is not split by warehouse, so it is never guessed. Clear the warehouse filter in the real screen to see company-wide totals.</p>
      </StateGate>
      {receive ? <ReceiveSheet key={receive.start?.id ?? "new"} loc={loc} start={receive.start} onClose={() => setReceive(null)} /> : null}
    </InventoryFrame>
  );
}
