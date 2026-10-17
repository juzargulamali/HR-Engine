"use client";

import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel, ErrorPanel, LoadingPanel, OverdueBanner, PermissionDenied, DueChip } from "../_components/ui";
import { PLink } from "../_components/context";
import { PREVIEW_STATES } from "../_lib/modules";

const PAGES = [
  { label: "Sales overview", path: "/os-preview/sales" },
  { label: "Opportunities", path: "/os-preview/sales/opportunities" },
  { label: "Pipeline", path: "/os-preview/sales/pipeline" },
  { label: "Clients & contacts", path: "/os-preview/sales/clients" },
  { label: "Follow-ups", path: "/os-preview/sales/follow-ups" },
  { label: "Proposals & quotes", path: "/os-preview/sales/proposals" },
  { label: "Reports", path: "/os-preview/sales/reports" },
  { label: "Settings", path: "/os-preview/sales/settings" },
];
const ONLY = PREVIEW_STATES.filter((s) => s !== "default");

export default function States() {
  return (
    <>
      <PageHeader eyebrow="Design preview" title="States gallery" description="Every Sales page can show loading, empty, error, permission-denied and overdue states. Below is how each looks, then links that force each state on the real pages." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Loading"><LoadingPanel rows={3} /></Panel>
        <Panel title="Empty"><EmptyState icon={Inbox} title="No opportunities yet" description="Record an enquiry with five quick fields. Unknown dates, budget and scope are fine." /></Panel>
        <Panel title="Error"><ErrorPanel what="opportunities" /></Panel>
        <Panel title="Permission denied"><PermissionDenied what="Sales & CRM" who="You have not been granted Sales access." /></Panel>
        <Panel title="Overdue"><OverdueBanner count={2} /><div className="flex flex-wrap items-center gap-2 text-sm"><span>Chase client on proposal v2</span><DueChip due="2026-10-16" /></div></Panel>
        <Panel title="Not collecting data yet"><p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Not collecting data yet</p></Panel>
        <Panel title="Email could not be sent" className="lg:col-span-2"><div role="alert" className="rounded-md border border-warning/60 bg-warning/10 px-4 py-3 text-sm text-foreground">The reminder email to Daniel Okafor could not be sent. <strong>The activity was saved.</strong> You can retry sending, or ignore it.</div></Panel>
      </div>
      <Panel title="Force a state on a real page" description="Opens the actual page with the state switched on. Only for the design review." className="mt-6">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table"><table className="w-full min-w-[34rem] text-sm"><caption className="sr-only">Links to each state per page</caption>
          <thead><tr className="text-left text-xs text-muted-foreground"><th scope="col" className="py-1.5 pr-3 font-medium">Page</th>{ONLY.map((s) => <th key={s} scope="col" className="px-2 py-1.5 font-medium capitalize">{s}</th>)}</tr></thead>
          <tbody>{PAGES.map((p) => <tr key={p.path} className="border-t border-border/60"><th scope="row" className="py-2 pr-3 text-left font-medium">{p.label}</th>{ONLY.map((s) => <td key={s} className="px-2 py-2"><PLink href={`${p.path}?state=${s}`} className="text-[hsl(var(--os-link))] hover:underline"><span className="capitalize">{s}</span><span className="sr-only"> state of {p.label}</span></PLink></td>)}</tr>)}</tbody>
        </table></div>
      </Panel>
    </>
  );
}
