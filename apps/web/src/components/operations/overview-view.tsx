import Link from "next/link";
import { CalendarClock, ClipboardList, PackageSearch, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { OsStatCard } from "@/components/os/stat-card";
import { Muted, Panel } from "@/components/projects/parts";
import { InfoHint } from "@/components/ui/info-hint";
import { CompanyTabs, ReadState, Unknown } from "@/components/operations/parts";
import { CountBar, HealthBadge, KindMark, ReadinessBar } from "@/components/operations/visuals";
import type { OpsResult } from "@/lib/operations/data";
import {
  AT_RISK_WINDOW_DAYS, STALLED_DAYS, datesWord, DECISION_WORDS, decisions, deliveryByWeek, EQUIPMENT_ISSUE_WORDS, equipmentIssues, eventLine, HEALTH_ORDER, HEALTH_WORDS, healthCounts, installationsWithin, isFinished,
  nextUnresolved, pressure, projectHealth, readiness, timeline, TIMELINE_DAYS, unitsOut, type Overview, type OverviewProject, type UpcomingRow,
} from "@/lib/operations/model";
import { dateRangeText, dateText } from "@/lib/projects/format";
import { cn } from "@/lib/utils";

const inDays = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
const WEEK_LIST = 4;
const EVIDENCE_SHOWN = 3;

/**
 * The Operations Overview. At a glance: four figures (each opens its records), then what waits for a decision next to the dated timeline, then the next
 * installations with their readiness, delivery by week, equipment issues and the health of every live project with the evidence behind each label.
 *
 * Every figure is the length of the list it opens, built from the same read, so a figure and its list cannot disagree. Nothing is scored. Colour is always
 * paired with a word. A part whose read failed says so and is never drawn as zero, empty or "on track".
 */
export function OverviewView({ header, companies, company, ov, up, today }: {
  header: React.ReactNode; companies: { id: string; name: string }[]; company: { id: string; name: string }; ov: { data: Overview }; up: OpsResult<UpcomingRow[]>; today: string;
}) {
  const self = `/operations?company=${company.id}`;
  const upcomingHref = `/operations/upcoming?company=${company.id}`;
  const o = ov.data;
  const items = decisions(o, today);
  const soon = installationsWithin(o, today);
  const issues = equipmentIssues(o, today);
  const weeks = deliveryByWeek(o, today);
  const maxWeek = Math.max(1, ...weeks.map((w) => w.projects.length));
  const entries = timeline(o, up.state === "ok" ? up.data : null, today);
  const counts = healthCounts(o, today);
  const live = o.projects.filter((p) => !isFinished(p.status) || unitsOut(p) > 0 || p.release_failed).map((p) => ({ p, h: projectHealth(p, today) }))
    .sort((a, b) => HEALTH_ORDER.indexOf(a.h.health) - HEALTH_ORDER.indexOf(b.h.health) || (a.p.install_start ?? a.p.event_start ?? "9999").localeCompare(b.p.install_start ?? b.p.event_start ?? "9999") || a.p.reference.localeCompare(b.p.reference));
  const overlaps = pressure(o).filter((x) => x.kind === "overlap" || x.kind === "reviews_overdue");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">{header}<CompanyTabs companies={companies} current={company.id} base="/operations" /></div>

      <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Operations at a glance" data-testid="ops-summary">
        <li><OsStatCard href={`${self}#decisions`} label="Needs my decision" value={items.length} icon={ClipboardList} edge={items.length > 0 ? "amber" : "muted"} /></li>
        <li><OsStatCard href={`${self}#installations`} label={`Installations in the next ${AT_RISK_WINDOW_DAYS} days`} value={soon.length} icon={CalendarClock} edge="blue" /></li>
        <li><OsStatCard href={`${self}#equipment`} label="Equipment issues" value={issues.length} icon={PackageSearch} edge={issues.length > 0 ? "amber" : "muted"} /></li>
        <li>{up.state === "ok"
          ? <OsStatCard href={upcomingHref} label="Upcoming Sales work" value={up.data.length} icon={ShoppingBag} edge="cyan" />
          : <OsStatCard href={upcomingHref} label="Upcoming Sales work" value="—" hint={up.state === "error" ? "Could not be loaded" : "Not shown"} icon={ShoppingBag} edge="muted" />}</li>
      </ul>

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] xl:items-start">
        <Panel id="decisions" className="order-1 scroll-mt-20" title={`Needs my decision (${items.length})`}
          hint={<><p>Each row says who it is with, since when and why, and gives one place to act.</p><p className="mt-1.5">What lands here: a submitted handover with no Project Manager or stalled for {STALLED_DAYS}+ days, an output waiting for Operations review, a blocker nobody has resolved, an installation in the next {AT_RISK_WINDOW_DAYS} days with a recorded problem, an equipment booking to review, and reservations that were not released.</p></>}>
          {items.length === 0 ? <Muted>Nothing recorded needs a decision right now.</Muted> : (
            <ul className="divide-y" data-testid="ops-decisions">
              {items.map((d) => (
                <li key={d.key} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0" data-testid={`ops-decision-${d.kind}`}>
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <Badge variant="outline" className={cn(d.kind === "pm_unassigned" || d.kind === "at_risk_installation" ? "border-[hsl(var(--os-red)/0.55)] text-[hsl(var(--os-red))]" : "border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]")}>{DECISION_WORDS[d.kind]}</Badge>
                      <span className="min-w-0 break-words font-medium">{d.title}</span>
                    </p>
                    <p className="mt-1 text-[13px] text-muted-foreground">{d.detail}</p>
                    <p className="mt-1 text-[13px]"><span className="text-muted-foreground">With</span> <span className="font-medium">{d.owner}</span>{d.date ? <> <span className="text-muted-foreground">· since</span> {dateText(d.date)}</> : null}</p>
                  </div>
                  <Link href={d.href} className={cn(buttonVariants({ variant: d.kind === "pm_unassigned" ? "default" : "outline", size: "sm" }), "flex-none")}>{d.action}</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="installations" className="order-2 scroll-mt-20 xl:col-start-1" title={`Next installations (${soon.length})`}
          hint={<p>Live projects whose installation or show starts within {AT_RISK_WINDOW_DAYS} days, with the Project Manager, the health label and how much of the equipment request is reserved or sent.</p>}>
          {soon.length === 0 ? <Muted>No live project has a recorded installation or show start in the next {AT_RISK_WINDOW_DAYS} days.</Muted> : (
            <ul className="divide-y" data-testid="ops-installations">
              {soon.map((p) => { const h = projectHealth(p, today); const r = readiness(p); return (
                <li key={p.id} className="grid gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]" data-testid={`ops-install-${p.reference}`}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><Link href={`/projects/${p.id}/work`} className="min-w-0 break-words text-sm font-medium text-accent underline-offset-4 hover:underline">{p.reference} {p.name}</Link><HealthBadge health={h.health} /></p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{p.pm_id ? p.pm : "No Project Manager"}{p.venue ? ` · ${p.venue}` : ""}</p>
                    {p.edition ? <p className="text-[12.5px] text-muted-foreground" data-testid="ops-edition">{p.edition}</p> : null}
                    {h.health !== "on_track" ? <p className="mt-0.5 text-[13px]"><Link href={h.evidence[0]!.href} className="underline-offset-4 hover:underline">{h.evidence[0]!.text}</Link>{h.evidence.length > 1 ? <span className="text-muted-foreground"> · {h.evidence.length - 1} more below</span> : null}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-end sm:justify-center">
                    <span className="text-sm"><KindMark kind={p.by} /> <span className="font-medium">{dateText(p.start)}</span> <span className="text-muted-foreground">({inDays(p.in_days)})</span></span>
                    {r ? <ReadinessBar value={r} /> : <span className="text-[12.5px] text-muted-foreground">{p.equipment.length === 0 ? "No equipment request recorded" : "No equipment lines waiting to be reserved"}</span>}
                  </div>
                </li>
              ); })}
            </ul>
          )}
        </Panel>

        <Panel className="order-3 xl:col-start-2 xl:row-span-2 xl:row-start-1" title={`Delivery timeline, next ${TIMELINE_DAYS} days`}
          hint={<><p>Installation, show and dismantling dates in date order. Enquiries without a project yet are marked tentative until Sales confirms the dates or wins the enquiry.</p><p className="mt-1.5">A project has no dismantling date of its own, so dismantling appears only where Sales recorded it on an enquiry.</p></>}>
          {up.state !== "ok" ? <p role="status" className="mb-2 text-[13px] text-[hsl(var(--os-amber))]">⚠ {up.state === "error" ? "Enquiry dates could not be loaded, so only project dates are shown." : "Enquiry dates are not shown."}</p> : null}
          {entries.length === 0 ? <Muted>No installation, show or dismantling date is recorded in the next {TIMELINE_DAYS} days.</Muted> : (
            <ol className="space-y-0" data-testid="ops-timeline">
              {entries.map((e, i) => { const newDay = i === 0 || entries[i - 1]!.date !== e.date; return (
                <li key={e.key} className={cn("grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 py-1.5", newDay && i > 0 && "mt-1 border-t pt-2.5")}>
                  <span className="text-[13px] font-medium tabular-nums">{newDay ? dateText(e.date) : <span className="sr-only">{dateText(e.date)}</span>}</span>
                  <span className="min-w-0 text-[13px]">
                    <KindMark kind={e.kind} />{e.tentative ? <span className="ml-1.5 rounded border border-dashed px-1 py-0.5 text-[11.5px] text-muted-foreground">Tentative</span> : null}
                    <Link href={e.href} className="ml-1.5 break-words font-medium underline-offset-4 hover:underline">{e.title}</Link>
                    <span className="block text-muted-foreground">{e.until && e.until !== e.date ? `until ${dateText(e.until)} · ` : ""}{e.who}</span>
                  </span>
                </li>
              ); })}
            </ol>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-2 xl:items-start">
        <Panel title="Upcoming delivery by week" hint={<p>Live projects by the week their installation (or show) starts. The number is the count of the projects listed under it.</p>}>
          {weeks.every((w) => w.projects.length === 0) ? <Muted>No live project in this company.</Muted> : (
            <ul className="space-y-3" data-testid="ops-weeks">
              {weeks.map((w) => (
                <li key={w.key} data-testid={`ops-week-${w.key}`}>
                  <div className="flex items-center gap-3">
                    <span className="w-28 flex-none text-[13px] font-medium sm:w-36">{w.from && w.to && w.key !== "started" ? <>{w.label.startsWith("Week of") ? dateText(w.from) : w.label}<span className="block text-[11.5px] font-normal text-muted-foreground">{dateRangeText(w.from, w.to)}</span></> : w.label}</span>
                    <CountBar count={w.projects.length} max={maxWeek} />
                    <span className="w-6 flex-none text-right text-sm font-semibold tabular-nums">{w.projects.length}</span>
                  </div>
                  {w.projects.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 border-l pl-3 text-[13px] sm:ml-[9.75rem] sm:border-l-0 sm:pl-0">
                      {w.projects.slice(0, WEEK_LIST).map((p) => <li key={p.id} className="flex flex-wrap items-baseline gap-x-2"><Link href={`/projects/${p.id}/work`} className="min-w-0 break-words underline-offset-4 hover:underline">{p.reference} {p.name}</Link><span className="text-muted-foreground">{p.install_start ?? p.event_start ? dateText((p.install_start ?? p.event_start)!) : "no date"} · {p.pm_id ? p.pm : "no Project Manager"}</span></li>)}
                      {w.projects.length > WEEK_LIST ? <li className="text-muted-foreground">and {w.projects.length - WEEK_LIST} more, listed under Project health below</li> : null}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="equipment" className="scroll-mt-20" title={`Equipment issues (${issues.length})`}
          hint={<><p>Recorded by the warehouse or raised by a date change. Operations reads them; the owner named on each line acts.</p><p className="mt-1.5">Listed: a shortage, an overdue return, a partial dispatch, a booking to review after a date change, or reservations that were not released.</p></>}>
          {issues.length === 0 ? <Muted>No equipment issue is recorded.</Muted> : (
            <ul className="divide-y" data-testid="ops-equipment">
              {issues.map((x) => (
                <li key={x.key} className="py-2.5 first:pt-0 last:pb-0" data-testid={`ops-equipment-${x.kind}`}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><Badge variant="outline" className={cn(x.kind === "shortage" || x.kind === "release_failed" || x.kind === "overdue_return" ? "border-[hsl(var(--os-red)/0.55)] text-[hsl(var(--os-red))]" : "border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]")}>{EQUIPMENT_ISSUE_WORDS[x.kind]}</Badge><Link href={x.href} className="min-w-0 break-words font-medium underline-offset-4 hover:underline">{x.project}</Link></p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{x.text} · <span className="text-foreground">With {x.owner}</span></p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel id="health" className="scroll-mt-20" title="Project health"
        hint={<><p>A label read from records, with the evidence behind it. It is not a score and says nothing about a person&apos;s performance.</p><p className="mt-1.5 font-medium">How the label is decided</p><ul className="mt-2 list-disc space-y-1 pl-4">
            <li><span className="font-medium text-foreground">{HEALTH_WORDS.at_risk}:</span> the installation (or show) starts within {AT_RISK_WINDOW_DAYS} days or is under way and a shortage, an unsent equipment request, a blocked or overdue task, an overdue milestone or an unreleased Delivery Plan line is recorded; or unused reservations were not released at completion; or equipment is past its return date.</li>
            <li><span className="font-medium text-foreground">{HEALTH_WORDS.needs_attention}:</span> a blocked task, no Project Manager, a blocker with nobody named to unblock it, a recorded shortage, a booking to review, an overdue task or milestone, or a finished project with equipment still out.</li>
            <li><span className="font-medium text-foreground">{HEALTH_WORDS.not_enough_info}:</span> none of those, and neither an installation nor a show date is recorded.</li>
            <li><span className="font-medium text-foreground">{HEALTH_WORDS.on_track}:</span> dates are recorded and none of the above is recorded.</li>
          </ul></>}>
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-2" aria-label="Projects by label" data-testid="ops-health-counts">
          {HEALTH_ORDER.map((k) => <li key={k} className="flex items-center gap-1.5 text-sm"><HealthBadge health={k} /><span className="font-semibold tabular-nums">{counts[k]}</span></li>)}
        </ul>
        {live.length === 0 ? <Muted>No live project in this company.</Muted> : (
          <ul className="grid gap-3 lg:grid-cols-2" data-testid="ops-health">
            {live.map(({ p, h }) => <HealthCard key={p.id} p={p} health={h} chatHref={p.chat_group_id ? `${self}&chat=${p.chat_group_id}` : null} />)}
          </ul>
        )}
      </Panel>

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-2 xl:items-start">
        <Panel title="Coming up from Sales" hint={<p>Enquiries Sales flagged for planning. No prices or commercial documents are shown.</p>} actions={<Link href={upcomingHref} className={buttonVariants({ variant: "outline", size: "sm" })}>Open Upcoming Work</Link>}>
          {up.state !== "ok" ? <ReadState result={up} what="Upcoming Work" retryHref={self} /> : up.data.length === 0 ? <Muted>No enquiry is flagged for Operations planning.</Muted> : (
            <ul className="divide-y" data-testid="ops-coming">
              {up.data.slice(0, 5).map((r) => { const dates = datesWord(r); const ev = eventLine(r); return (
                <li key={r.id} className="py-2.5 text-sm first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-baseline gap-x-2"><Link href={`${upcomingHref}&q=${encodeURIComponent(r.reference)}`} className="min-w-0 break-words font-medium underline-offset-4 hover:underline">{ev.event}</Link><span className="font-mono text-[12.5px] text-muted-foreground">{r.reference}</span></p>
                  <p className="text-[13px] text-muted-foreground">{r.install_start || r.event_start ? dateText((r.install_start ?? r.event_start)!) : "No date recorded"} · {dates.tentative ? "Tentative" : r.won ? "Won" : "Dates confirmed"}{ev.venue ? ` · ${ev.venue}` : ""}</p>
                  <p className="text-[13px]">Next: {nextUnresolved(r)}</p>
                </li>
              ); })}
            </ul>
          )}
          {up.state === "ok" && up.data.length > 5 ? <Muted className="mt-2">{up.data.length - 5} more in Upcoming Work.</Muted> : null}
        </Panel>

        <Panel title={`Team pressure (${overlaps.length})`}
          hint={<><p>People on two projects whose dates overlap, and reviews past the task&apos;s date. Only what is recorded; it is not a capacity figure.</p><p className="mt-1.5">An overlap shows only when both projects have their dates and people recorded.</p></>}>
          {overlaps.length === 0 ? <Muted>Nothing recorded.</Muted> : (
            <ul className="space-y-1.5 text-[13px]" data-testid="ops-pressure">{overlaps.map((x) => <li key={x.key}><Link href={x.href} className="underline-offset-4 hover:underline">{x.text}</Link></li>)}</ul>
          )}
        </Panel>
      </div>
      <Muted>Read {dateText(o.taken_at.slice(0, 10))}. <InfoHint label="what Operations can change" className="ml-0.5">Operations reads these records; it does not change tasks, bookings or stock. Each link opens the screen where the responsible person acts.</InfoHint></Muted>
    </div>
  );
}

function HealthCard({ p, health, chatHref }: { p: OverviewProject; health: ReturnType<typeof projectHealth>; chatHref: string | null }) {
  const r = readiness(p);
  const shown = health.evidence.slice(0, EVIDENCE_SHOWN);
  return (
    <li className="min-w-0 rounded-md border p-3" data-testid={`ops-project-${p.reference}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <Link href={`/projects/${p.id}/work`} className="min-w-0 break-words text-sm font-medium text-accent underline-offset-4 hover:underline">{p.reference} {p.name}</Link>
        <HealthBadge health={health.health} />
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {p.pm_id ? p.pm : "No Project Manager"} · {p.install_start ? `Installation ${dateText(p.install_start)}` : p.event_start ? `Show ${dateRangeText(p.event_start, p.event_end)}` : "No date recorded"}{isFinished(p.status) ? " · Delivery complete" : ""}
      </p>
      {p.edition ? <p className="text-[12.5px] text-muted-foreground" data-testid="ops-edition">{p.edition}</p> : null}
      <ul className="mt-2 space-y-0.5 text-[13px]" aria-label="Evidence">
        {shown.map((e, i) => <li key={i} className="flex gap-1.5"><span aria-hidden className="text-muted-foreground">›</span><Link href={e.href} className="min-w-0 break-words underline-offset-4 hover:underline">{e.text}</Link></li>)}
        {health.evidence.length > shown.length ? <li className="text-muted-foreground">and {health.evidence.length - shown.length} more on the project</li> : null}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {r ? <ReadinessBar value={r} /> : <span className="text-[12.5px] text-muted-foreground">{p.equipment.length === 0 ? <Unknown>No equipment request recorded</Unknown> : `${p.tasks_open} open task${p.tasks_open === 1 ? "" : "s"}`}</span>}
        {chatHref ? <Link href={chatHref} className="text-[13px] text-accent underline-offset-4 hover:underline">Project chat</Link> : null}
      </div>
    </li>
  );
}
