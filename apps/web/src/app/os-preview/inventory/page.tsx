"use client";

import { INVENTORY_SAMPLE } from "../_lib/delivery";
import { DesignOnlyButton, FutureBanner } from "../_components/future";
import { Chip, PageHeader, Panel } from "../_components/ui";

export default function Inventory() {
  return (
    <>
      <PageHeader eyebrow="Inventory" title="Technology inventory" description="Technology stock and components: where it is, its condition, and when it is dispatched or returned." actions={<DesignOnlyButton>Add item</DesignOnlyButton>} />
      <FutureBanner release="Release 3" />
      <div className="grid gap-6">
        <Panel flush>
          <div className="hidden md:block"><table className="w-full text-sm"><caption className="sr-only">Sample inventory</caption>
            <thead className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground"><tr>{["Item", "Kind", "Location", "Condition", "Status"].map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{INVENTORY_SAMPLE.map((i) => <tr key={i.item} className="border-b border-border/60 last:border-0"><th scope="row" className="px-4 py-3 text-left font-medium">{i.item}</th><td className="px-4 py-3">{i.kind}</td><td className="px-4 py-3">{i.location}</td><td className="px-4 py-3">{i.condition}</td><td className="px-4 py-3">{i.status}</td></tr>)}</tbody>
          </table></div>
          <ul className="divide-y divide-border/70 md:hidden">{INVENTORY_SAMPLE.map((i) => <li key={i.item} className="px-4 py-3 text-sm"><p className="font-medium">{i.item}</p><p className="text-xs text-muted-foreground">{i.kind} · {i.location}</p><p className="text-xs">{i.condition} · {i.status}</p></li>)}</ul>
        </Panel>
        <Panel title="Dispatch and return" description="Warehouse and PM handle components, dispatch, return and condition.">
          <ol className="flex flex-wrap gap-2 text-sm">{["Reserved for a project", "Dispatched", "On site", "Returned", "Condition checked"].map((s, i) => <li key={s} className="flex items-center gap-2"><Chip tone={i === 1 ? "info" : "neutral"}>{i + 1}. {s}</Chip></li>)}</ol>
        </Panel>
        <Panel title="How this differs from other things">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground"><li><strong className="text-foreground">Assets</strong> (existing, in People &amp; HR): company equipment issued to one employee, such as a laptop.</li><li><strong className="text-foreground">Purchasing</strong>: asking Admin to buy or rent something we do not have.</li><li><strong className="text-foreground">Inventory</strong>: the technology and components we own and send to project sites.</li></ul>
        </Panel>
      </div>
    </>
  );
}
