import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Muted, Panel } from "@/components/projects/parts";
import { CompanyTabs, ReadState, Unknown } from "@/components/operations/parts";
import type { OpsResult } from "@/lib/operations/data";
import { completeButOut, datesWord, DECISION_WORDS, decisions, equipmentLine, nextResponsible, pressure, STAGE_WORDS, topIssue, upcomingDelivery, type Overview, type PressureItem, type UpcomingRow } from "@/lib/operations/model";
import { dateRangeText, dateText } from "@/lib/projects/format";
import { cn } from "@/lib/utils";

const PRESSURE_WORDS: Record<PressureItem["kind"], string> = { overlap: "Overlapping commitments", reviews_overdue: "Overdue reviews", shortage: "Equipment shortages", partial_dispatch: "Partial dispatch", overdue_return: "Overdue returns" };

/**
 * The Operations Overview as it is shown, from the two reads. What needs a decision comes first, then what is coming from Sales, then upcoming delivery, then team and
 * warehouse pressure. Every item is a recorded fact with its owner and a link to the screen where the responsible person acts.
 */
export function OverviewView({ header, companies, company, ov, up, today }: {
  header: React.ReactNode; companies: { id: string; name: string }[]; company: { id: string; name: string }; ov: { data: Overview }; up: OpsResult<UpcomingRow[]>; today: string;
}) {
  const self = `/operations?company=${company.id}`;
  const items = decisions(ov.data, today);
  const delivery = upcomingDelivery(ov.data);
  const press = pressure(ov.data);
  return (
    <div className="space-y-5">
      {header}
      <CompanyTabs companies={companies} current={company.id} base="/operations" />

      <Panel title={`Needs my decision (${items.length})`} description="Recorded situations that wait for someone. Each one names who it is with and opens the screen where they act.">
        {items.length === 0 ? <Muted>Nothing recorded needs a decision right now: every submitted handover has a Project Manager, no listed blocker is waiting, and no installation in the next 14 days has a recorded problem.</Muted> : (
          <ul className="space-y-2" data-testid="ops-decisions">
            {items.map((d) => (
              <li key={d.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border p-3" data-testid={`ops-decision-${d.kind}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm"><Badge variant="outline" className={cn(d.kind === "pm_unassigned" || d.kind === "at_risk_installation" ? "border-destructive text-destructive" : "border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]")}>{DECISION_WORDS[d.kind]}</Badge> <span className="font-medium">{d.title}</span></p>
                  <p className="mt-1 text-[13px] text-muted-foreground">{d.detail}</p>
                  <p className="text-[13px]">With: {d.owner}{d.date ? ` · ${dateText(d.date)}` : ""}</p>
                </div>
                <Link href={d.href} className={buttonVariants({ variant: "outline", size: "sm" })}>{d.action}</Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Coming up from Sales" description="Enquiries Sales flagged for planning. Tentative until the enquiry is won." actions={<Link href={`/operations/upcoming?company=${company.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open Upcoming Work</Link>}>
        {up.state !== "ok" ? <ReadState result={up} what="Upcoming Work" retryHref={self} /> : up.data.length === 0 ? <Muted>No enquiry is flagged for Operations planning.</Muted> : (
          <ul className="divide-y" data-testid="ops-coming">
            {up.data.slice(0, 6).map((r) => { const next = nextResponsible(r); const dates = datesWord(r); return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-mono text-[13px] text-muted-foreground">{r.reference}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                <span className="text-[13px] text-muted-foreground">{STAGE_WORDS[r.stage] ?? r.stage} · {dates.text}</span>
                <span className="text-[13px]">{r.install_start || r.event_start ? dateText((r.install_start ?? r.event_start)!) : "No date recorded"}</span>
                <span className="w-full text-[13px] text-muted-foreground sm:w-auto">Next: {next.who}, {next.what.charAt(0).toLowerCase()}{next.what.slice(1)}</span>
              </li>
            ); })}
          </ul>
        )}
        {up.state === "ok" && up.data.length > 6 ? <Muted className="mt-2">{up.data.length - 6} more in Upcoming Work.</Muted> : null}
      </Panel>

      <Panel title="Upcoming delivery" description="Projects by their next recorded date, with the Project Manager, the venue and the most relevant open issue. A finished project stays here while its equipment is out.">
        {delivery.length === 0 ? <Muted>No live project in this company.</Muted> : (
          <ul className="space-y-2" data-testid="ops-delivery">
            {delivery.map((p) => { const issue = topIssue(p, today); return (
              <li key={p.id} className="rounded-md border p-3" data-testid={`ops-project-${p.reference}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/projects/${p.id}/work`} className="font-medium text-accent underline-offset-4 hover:underline">{p.reference} {p.name}</Link>
                  <Badge variant="outline">{p.status.replace(/_/g, " ")}</Badge>
                  {completeButOut(p) ? <Badge variant="outline" className="border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]">Delivery complete · equipment still out</Badge> : null}
                  {p.chat_group_id ? <Link href={`${self}&chat=${p.chat_group_id}`} className="ml-auto text-[13px] text-accent underline-offset-4 hover:underline">Open project chat</Link> : null}
                </div>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-muted-foreground">Project Manager</dt><dd>{p.pm}</dd></div>
                  <div><dt className="text-muted-foreground">Venue</dt><dd>{p.venue ?? <Unknown />}{p.edition ? ` · ${p.edition}` : ""}</dd></div>
                  <div><dt className="text-muted-foreground">Installation</dt><dd>{p.install_start ? dateText(p.install_start) : <Unknown />}</dd></div>
                  <div><dt className="text-muted-foreground">Show</dt><dd>{p.event_start || p.event_end ? dateRangeText(p.event_start, p.event_end) : <Unknown />}</dd></div>
                  <div><dt className="text-muted-foreground">Dismantling</dt><dd><Unknown>Not recorded on the project</Unknown></dd></div>
                  <div><dt className="text-muted-foreground">Next milestone</dt><dd>{p.next_milestone ? `${p.next_milestone.title}${p.next_milestone.due_date ? `, ${dateText(p.next_milestone.due_date)}` : ""}` : <Unknown>None open</Unknown>}</dd></div>
                  <div><dt className="text-muted-foreground">Tasks</dt><dd>{p.tasks_open} open{p.tasks_overdue > 0 ? `, ${p.tasks_overdue} overdue` : ""}{p.blockers.length > 0 ? `, ${p.blockers.length} blocked` : ""}</dd></div>
                  <div><dt className="text-muted-foreground">Most relevant issue</dt><dd className={cn(issue && "font-medium")}>{issue ?? "Nothing recorded"}</dd></div>
                </dl>
                {p.equipment.length > 0 ? <ul className="mt-2 space-y-0.5 text-[13px] text-muted-foreground">{p.equipment.map((q) => <li key={q.id}><Link href={`/projects/${p.id}/equipment`} className="underline-offset-4 hover:underline">{equipmentLine(q)}</Link></li>)}</ul> : <p className="mt-2 text-[13px] text-muted-foreground">Equipment: no request recorded.</p>}
              </li>
            ); })}
          </ul>
        )}
      </Panel>

      <Panel title="Team and warehouse pressure" description="Only what is recorded: people on two projects whose dates overlap, reviews past their date, shortages, partial dispatch and overdue returns. It is not a capacity figure.">
        {press.length === 0 ? <Muted>Nothing recorded. Overlaps need both projects to have their dates and people recorded, so a clash that is not recorded will not show here.</Muted> : (
          <div className="space-y-3" data-testid="ops-pressure">
            {(Object.keys(PRESSURE_WORDS) as PressureItem["kind"][]).map((k) => { const list = press.filter((x) => x.kind === k); return list.length === 0 ? null : (
              <div key={k}>
                <h3 className="text-sm font-semibold">{PRESSURE_WORDS[k]} ({list.length})</h3>
                <ul className="mt-1 space-y-0.5 text-[13px]">{list.map((x) => <li key={x.key}><Link href={x.href} className="underline-offset-4 hover:underline">{x.text}</Link></li>)}</ul>
              </div>
            ); })}
          </div>
        )}
      </Panel>
      <Muted>Read {dateText(ov.data.taken_at.slice(0, 10))}. Operations reads these records; it does not change tasks, bookings or stock. Each link opens the screen where the responsible person acts.</Muted>
    </div>
  );
}
