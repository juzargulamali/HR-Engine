import Link from "next/link";
import { RequestStatusBadge } from "@/components/inventory/planning/status";
import { PLAN_FIELDS, formatInZone, formatLocalPlan } from "@/lib/inventory/planning";
import type { RequestModel } from "@/lib/inventory/planning-data";
import { cn } from "@/lib/utils";

/**
 * What stays visible through Prepare, Send out and Receive back: the request, who it is for, where it is collected, and the three dates the warehouse
 * works to (the booking window, the dispatch date, when it is due back). The full planning schedule is one click away under "More dates"; the booking
 * window is the earliest to the latest of those dates, so preparation and inspection time stay in the availability calculation.
 */
export function WorkspaceHeader({ model, pickupName, now = new Date() }: { model: RequestModel; pickupName: string | null; now?: Date }) {
  const r = model.request;
  const plan = (r.plan ?? {}) as Record<string, string | null | undefined>;
  const late = !!r.expected_return_at && new Date(r.expected_return_at).getTime() < now.getTime() && r.status !== "closed" && r.status !== "cancelled";
  const fact = (label: string, value: string, bad = false) => (
    <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={cn("text-sm font-medium", bad && "text-destructive")}>{value}</dd></div>
  );
  return (
    <section aria-label="Request" className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm"><RequestStatusBadge status={r.status} /><span className="font-mono text-muted-foreground">{r.code}</span></div>
          <p className="mt-1 break-words font-heading text-xl font-semibold">{model.forLabel}</p>
          <p className="text-sm text-muted-foreground">{r.kind === "project" ? "Project" : "Employee"} request{pickupName ? ` · collected from ${pickupName}` : ""}{r.destination ? ` · to ${r.destination}` : ""}</p>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
          {fact("Booking window", r.needed_from ? `${formatInZone(r.needed_from, r.timezone)} to ${r.needed_until ? formatInZone(r.needed_until, r.timezone) : "no end yet"}` : "Dates not set")}
          {fact("Dispatch", plan.dispatch ? formatLocalPlan(plan.dispatch) : "Not set")}
          {fact("Due back", r.expected_return_at ? `${formatInZone(r.expected_return_at, r.timezone)}${late ? " · late" : ""}` : "Not set", late)}
        </dl>
      </div>
      <details className="group mt-3 text-sm">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-[hsl(var(--os-link))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">More dates</summary>
        <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_FIELDS.map((f) => <div key={f.key}><dt className="text-xs text-muted-foreground">{f.label}</dt><dd>{formatLocalPlan(plan[f.key])}</dd></div>)}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">Local time in {r.timezone}. The booking window runs from the earliest to the latest of these, so preparation and inspection time are held for this request and counted when availability is checked. <Link href={`/inventory/requests?open=${r.id}`} className="underline underline-offset-2">Change the dates</Link></p>
      </details>
    </section>
  );
}
