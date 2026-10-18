"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { PROPOSALS, ZOHO, fmtDate, oppById, personName } from "../../_lib/data";
import { PLink } from "../../_components/context";
import { Chip, PageHeader, Panel, StateGate } from "../../_components/ui";

export default function Proposals() {
  const [status, setStatus] = useState("all");
  const rows = PROPOSALS.filter((p) => status === "all" || p.status === status).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <PageHeader eyebrow="Sales & CRM" title="Proposals & quotes" />
      <StateGate what="proposals" emptyTitle="No proposals yet" emptyText="Versions appear here when they are recorded on an opportunity.">
        <div className="mb-4 flex items-center gap-2 text-sm"><label htmlFor="ps" className="text-muted-foreground">Status</label>
          <Select id="ps" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-44"><option value="all">All</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="superseded">Superseded</option></Select></div>
        <Panel flush>
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Proposal versions</caption>
              <thead className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground"><tr>{["Opportunity", "Version", "Author", "Added", "Status", "Zoho quote", "Invoice", "Customer payment"].map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((p) => { const z = ZOHO.find((x) => x.oppId === p.oppId); const o = oppById(p.oppId); return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3"><PLink href={`/os-preview/sales/opportunities/${o.ref}?tab=proposals`} className="font-medium hover:underline">{o.title}</PLink><div className="text-xs text-muted-foreground">{o.ref}</div></td>
                    <td className="px-4 py-3">v{p.version}</td><td className="px-4 py-3">{personName(p.author)}</td><td className="px-4 py-3 whitespace-nowrap">{fmtDate(p.date)}</td>
                    <td className="px-4 py-3"><Chip tone={p.status === "sent" ? "info" : p.status === "accepted" ? "good" : "neutral"}>{p.status === "draft" ? "Draft" : p.status === "sent" ? "Sent" : p.status === "accepted" ? "Accepted" : "Superseded"}</Chip></td>
                    <td className="px-4 py-3 text-xs">{z?.quoteRef ?? "Not recorded"}</td><td className="px-4 py-3 text-xs">{z?.invoiceRef ?? "Not recorded"}</td><td className="px-4 py-3 text-xs">{z?.paymentReceivedOn ? fmtDate(z.paymentReceivedOn) : "Not recorded"}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-border/70 md:hidden">
            {rows.map((p) => { const o = oppById(p.oppId); const z = ZOHO.find((x) => x.oppId === p.oppId); return (
              <li key={p.id} className="px-4 py-3"><div className="flex items-start justify-between gap-2"><PLink href={`/os-preview/sales/opportunities/${o.ref}?tab=proposals`} className="text-sm font-medium hover:underline">{o.title}</PLink><Chip tone={p.status === "sent" ? "info" : p.status === "accepted" ? "good" : "neutral"}>{p.status}</Chip></div><p className="text-xs text-muted-foreground">v{p.version} · {personName(p.author)} · {fmtDate(p.date)}</p><p className="text-xs text-muted-foreground">Quote {z?.quoteRef ?? "not recorded"} · Invoice {z?.invoiceRef ?? "not recorded"}</p></li>
            ); })}
          </ul>
        </Panel>
        
      </StateGate>
    </>
  );
}
