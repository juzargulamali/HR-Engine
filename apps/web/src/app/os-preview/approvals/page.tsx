"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { APPROVALS_SAMPLE } from "../_lib/delivery";
import { DesignOnlyButton } from "../_components/future";
import { Chip, PageHeader, Panel } from "../_components/ui";

type View = "all" | "hr" | "commercial";

export default function Approvals() {
  const [view, setView] = useState<View>("all");
  const rows = APPROVALS_SAMPLE.filter((a) => view === "all" || (view === "hr" ? a.live : !a.live));
  return (
    <>
      <PageHeader eyebrow="Approvals" title="Approvals" />
      <SegmentedControl<View> aria-label="Approvals view" value={view} onChange={setView} className="mb-4" options={[{ value: "all", label: "All" }, { value: "hr", label: "HR (existing)" }, { value: "commercial", label: "Commercial and purchasing" }]} />
      <Panel flush>
        <ul className="divide-y divide-border/70">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-[12rem] flex-1"><p className="text-sm font-medium">{a.title}</p><p className="text-xs text-muted-foreground">{a.kind} · from {a.from} · {a.when} · {a.module}</p></div>
              {a.live ? <><Chip tone="good">Existing</Chip><a href="https://hr-engine-web.vercel.app" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--os-link))] hover:underline">Decide in HR app<ArrowUpRight className="h-3 w-3" aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a></> : <><Chip>Design only</Chip><DesignOnlyButton>Approve</DesignOnlyButton><DesignOnlyButton>Reject</DesignOnlyButton></>}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
