"use client";

import { ArrowUpRight } from "lucide-react";
import { Chip, PageHeader, Panel } from "../_components/ui";
import { FutureBanner } from "../_components/future";

const KPIS = ["Enquiry response time", "Proposal turnaround", "Win rate", "Project on-time delivery", "Task completion", "Utilisation by department"];

export default function Performance() {
  return (
    <>
      <PageHeader eyebrow="Performance & KPIs" title="Performance & KPIs" description="Appraisals already exist. KPIs appear once the modules that produce their data are in daily use." />
      <FutureBanner release="Release 5; appraisals unchanged" />
      <div className="grid gap-6">
        <Panel title="Appraisals" description="Existing in People & HR: goals, cycles and reviews."><div className="flex items-center gap-3"><Chip tone="good">Existing</Chip><a href="https://hr-engine-web.vercel.app" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--os-link))] hover:underline">Open appraisals in the HR app<ArrowUpRight className="h-3.5 w-3.5" aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a></div></Panel>
        <Panel title="KPIs" description="No figure is shown until real data is being collected for it.">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{KPIS.map((k) => <li key={k} className="rounded-lg border border-dashed border-border p-4"><p className="text-sm font-medium">{k}</p><p className="mt-2 text-sm text-muted-foreground">Not collecting data yet</p></li>)}</ul>
        </Panel>
      </div>
    </>
  );
}
