"use client";

import { Chip, PageHeader, Panel } from "../_components/ui";
import { PLink } from "../_components/context";
import { FutureBanner } from "../_components/future";

const CATALOGUE = [
  { n: "Sales pipeline, follow-ups, won and lost", d: "Inside Sales & CRM.", s: "Available first", href: "/os-preview/sales/reports" },
  { n: "Project health and deadlines", d: "From Projects & Tasks.", s: "Coming soon" },
  { n: "Technology utilisation", d: "From Inventory.", s: "Coming soon" },
  { n: "Spend against budget", d: "From Purchasing and Zoho Books references.", s: "Coming soon" },
  { n: "Company overview", d: "Cross-module, for founders.", s: "Coming soon" },
];

export default function Reports() {
  return (
    <>
      <PageHeader eyebrow="Reports" title="Reports" />
      <FutureBanner />
      <Panel flush>
        <ul className="divide-y divide-border/70">
          {CATALOGUE.map((c) => <li key={c.n} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-[12rem] flex-1"><p className="text-sm font-medium">{c.n}</p><p className="text-xs text-muted-foreground">{c.d}</p></div><Chip tone={c.href ? "info" : "neutral"}>{c.s}</Chip>{c.href ? <PLink href={c.href} className="text-xs font-medium text-[hsl(var(--os-link))] hover:underline">Open design</PLink> : null}</li>)}
        </ul>
      </Panel>
    </>
  );
}
