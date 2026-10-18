"use client";

import { INVENTORY_SAMPLE } from "../_lib/delivery";
import { DesignOnlyButton, FutureBanner } from "../_components/future";
import { Chip, PageHeader, Panel } from "../_components/ui";

export default function Inventory() {
  return (
    <>
      <PageHeader eyebrow="Inventory" title="Technology inventory" actions={<DesignOnlyButton>Add item</DesignOnlyButton>} />
      <FutureBanner />
      <div className="grid gap-6">
        <Panel flush>
          <div className="hidden md:block"><table className="w-full text-sm"><caption className="sr-only">Sample inventory</caption>
            <thead className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground"><tr>{["Item", "Kind", "Location", "Condition", "Status"].map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{INVENTORY_SAMPLE.map((i) => <tr key={i.item} className="border-b border-border/60 last:border-0"><th scope="row" className="px-4 py-3 text-left font-medium">{i.item}</th><td className="px-4 py-3">{i.kind}</td><td className="px-4 py-3">{i.location}</td><td className="px-4 py-3">{i.condition}</td><td className="px-4 py-3">{i.status}</td></tr>)}</tbody>
          </table></div>
          <ul className="divide-y divide-border/70 md:hidden">{INVENTORY_SAMPLE.map((i) => <li key={i.item} className="px-4 py-3 text-sm"><p className="font-medium">{i.item}</p><p className="text-xs text-muted-foreground">{i.kind} · {i.location}</p><p className="text-xs">{i.condition} · {i.status}</p></li>)}</ul>
        </Panel>
        <Panel title="Dispatch and return">
          <ol className="flex flex-wrap gap-2 text-sm">{["Reserved for a project", "Dispatched", "On site", "Returned", "Condition checked"].map((s, i) => <li key={s} className="flex items-center gap-2"><Chip tone={i === 1 ? "info" : "neutral"}>{i + 1}. {s}</Chip></li>)}</ol>
        </Panel>
        <Panel title="Not the same as" help="Assets are company equipment issued to one employee. Purchasing asks Admin to buy or rent something we do not have. Inventory is the technology and components we own and send to project sites.">
          <ul className="list-disc space-y-1 pl-5 text-sm"><li><strong>Assets</strong>: a laptop issued to one person.</li><li><strong>Purchasing</strong>: buying or renting what we do not have.</li><li><strong>Inventory</strong>: our technology and components for project sites.</li></ul>
        </Panel>
      </div>
    </>
  );
}
