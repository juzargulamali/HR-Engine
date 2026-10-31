"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HISTORY, fmtDayTime, type MovementRow } from "../../_lib/inventory-concept";
import { InventoryFrame } from "../../_components/inventory-bits";
import { Chip, Sheet, StateGate } from "../../_components/ui";

export default function History() {
  const [open, setOpen] = useState<MovementRow | null>(null);
  const [q, setQ] = useState("");
  const rows = HISTORY.filter((h) => `${h.what} ${h.qty} ${h.route} ${h.ref} ${h.who}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <InventoryFrame section="history" title="History" description="Everything recorded, newest first. Records are never edited; a mistake is corrected by a new entry.">
      <StateGate what="the movement history" emptyTitle="No movements recorded yet" emptyText="Movements appear here as soon as stock is received, sent or returned." deniedWho="Your account cannot see stock movements.">
        <div className="mb-3"><label htmlFor="hist-q" className="sr-only">Search history</label><Input id="hist-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by equipment, project, person or reference" className="h-11 sm:h-9 sm:max-w-md" /></div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <ul className="divide-y divide-border/70">
            {rows.map((h) => (
              <li key={h.id} className="relative grid gap-1 px-4 py-3 transition-colors focus-within:bg-secondary/40 hover:bg-secondary/40 md:grid-cols-[9rem_10rem_minmax(0,1.4fr)_minmax(0,1.6fr)_8rem] md:items-center md:gap-3">
                <p className="text-sm text-muted-foreground">{fmtDayTime(h.when)}</p>
                <p><Chip>{h.what}</Chip></p>
                <button type="button" onClick={() => setOpen(h)} className="text-left text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:underline focus-visible:outline-none">{h.qty}</button>
                <p className="text-sm text-muted-foreground">{h.route}</p>
                <p className="text-sm text-muted-foreground md:text-right">{h.who} · {h.ref}</p>
              </li>
            ))}
            {rows.length === 0 ? <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing matches “{q}”.</li> : null}
          </ul>
        </div>
      </StateGate>
      {open ? (
        <Sheet open onClose={() => setOpen(null)} title={open.what}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">When</dt><dd>{fmtDayTime(open.when)}</dd>
            <dt className="text-muted-foreground">What</dt><dd className="font-medium">{open.qty}</dd>
            <dt className="text-muted-foreground">From → to</dt><dd>{open.route}</dd>
            <dt className="text-muted-foreground">Recorded by</dt><dd>{open.who}</dd>
            <dt className="text-muted-foreground">Request or transfer</dt><dd>{open.ref}</dd>
          </dl>
          <details className="mt-3 rounded-md border border-border px-3 py-2 text-sm"><summary className="cursor-pointer font-medium">Transaction details</summary><p className="mt-2 text-muted-foreground">The entry id and the key that makes a repeated click safe are kept here, as today.</p></details>
          <div className="mt-4"><Button type="button" variant="outline" onClick={() => setOpen(null)}>Close</Button></div>
        </Sheet>
      ) : null}
    </InventoryFrame>
  );
}
