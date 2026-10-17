"use client";

import { PURCHASE_REQUESTS_SAMPLE, VENDORS_SAMPLE } from "../_lib/delivery";
import { DesignOnlyButton, FutureBanner } from "../_components/future";
import { Chip, PageHeader, Panel } from "../_components/ui";

export default function Vendors() {
  return (
    <>
      <PageHeader eyebrow="Vendors & Purchasing" title="Vendors and purchase requests" actions={<DesignOnlyButton>New request</DesignOnlyButton>} />
      <FutureBanner />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Vendors" flush><ul className="divide-y divide-border/70">{VENDORS_SAMPLE.map((v) => <li key={v.vendor} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-[12rem] flex-1"><p className="text-sm font-medium">{v.vendor}</p><p className="text-xs text-muted-foreground">{v.category} · {v.note}</p></div><Chip tone={v.status === "Active" ? "good" : "warn"}>{v.status}</Chip></li>)}</ul></Panel>
        <Panel title="Purchase and rental requests" flush><ul className="divide-y divide-border/70">{PURCHASE_REQUESTS_SAMPLE.map((r) => <li key={r.ref} className="px-4 py-3"><div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{r.what}</p><Chip tone="info">{r.status}</Chip></div><p className="text-xs text-muted-foreground">{r.ref} · {r.type} · requested by {r.by} · {r.amount}</p></li>)}</ul></Panel>
      </div>
    </>
  );
}
