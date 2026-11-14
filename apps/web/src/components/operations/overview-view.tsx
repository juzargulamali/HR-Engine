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
  AT_RISK_WINDOW_DAYS, STALLED_DAYS, datesWord, DECISION_WORDS, decisions, deliveryByWeek, EQUIPMENT_ISSUE_WORDS, equipmentIssues, eventLine, groupEntries, HEALTH_ORDER, HEALTH_WORDS, healthCounts, installationsWithin, isFinished,
  laterEntries, NEXT_ON_SITE_DAYS, nextOnSite, nextUnresolved, pressure, projectHealth, readiness, SITE_ACTIVITY_LIMIT, splitDecisions, TIMELINE_DAYS, unitsOut, type DecisionItem, type Overview, type OverviewProject, type TimelineEntry,
  type UpcomingRow,
} from "@/lib/operations/model";
import type { SiteActivityRead } from "@/lib/projects/phase2/model";
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
export function OverviewView({ header, companies, company, ov, up, sites, today, viewerId }: {
  header: React.ReactNode; companies: { id: string; name: string }[]; company: { id: string; name: string }; ov: { data: Overview }; up: OpsResult<UpcomingRow[]>; sites: OpsResult<SiteActivityRead[]>; today: string; viewerId: string;
}) {
  const self = `/operations?company=${company.id}`;
  const upcomingHref = `/operations/upcoming?company=${company.id}`;
  const o = ov.data;
  const items = decisions(o, today, viewerId);
  const { mine, followUps } = splitDecisions(items);
  // One read of the dated site activities feeds Next on site, the timeline and team pressure; without it every list falls back to project header dates and says so.
  const acts = sites.state === "ok" ? sites.data : null;
  const nextSite = nextOnSite(o, acts, today);
  const soon = installationsWithin(o, today);
  const issues = equipmentIssues(o, today);
  const weeks = deliveryByWeek(o, today);
  const maxWeek = Math.max(1, ...weeks.map((w) => w.projects.length));
  const groups = groupEntries(laterEntries(o, up.state === "ok" ? up.data : null, acts, today));
  const counts = healthCounts(o, today);
  const live = o.projects.filter((p) => !isFinished(p.status) || unitsOut(p) > 0 || p.release_failed).map((p) => ({ p, h: projectHealth(p, today) }))
    .sort((a, b) => HEALTH_ORDER.indexOf(a.h.health) - HEALTH_ORDER.indexOf(b.h.health) || (a.p.install_start ?? a.p.event_start ?? "9999").localeCompare(b.p.install_start ?? b.p.event_start ?? "9999") || a.p.reference.localeCompare(b.p.reference));
  const overlaps = pressure(o, acts).filter((x) => x.kind === "overlap" || x.kind === "crew_overlap" || x.kind === "reviews_overdue");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">{header}<CompanyTabs companies={companies} current={company.id} base="/operations" /></div>

      <Panel id="decisions" className="scroll-mt-20" title={`Needs my decision (${items.length})`}
        hint={<><p>Each row says who it is with, since when and why, and gives one place to act. Decisions assigned to you come first, then the follow-ups, each with the person or role it waits on.</p><p className="mt-1.5">What lands here: a submitted handover with no Project Manager or stalled for {STALLED_DAYS}+ days, an output waiting for Operations review, a blocker nobody has resolved, an installation in the next {AT_RISK_WINDOW_DAYS} days with a recorded problem, an equipment booking to review, and reservations that were not released.</p></>}>
        {items.length === 0 ? <Muted>Nothing recorded needs a decision right now.</Muted> : (
          <div className="space-y-4" data-testid="ops-decisions">
            <section aria-labelledby="ops-mine-h" data-testid="ops-decisions-mine">
              <h3 id="ops-mine-h" className="mb-1 text-sm font-semibold">Decisions assigned to me ({mine.length})</h3>
              {mine.length === 0 ? <Muted>Nothing is assigned to you by name.</Muted> : <ul className="divide-y">{mine.map((d) => <DecisionRow key={d.key} d={d} />)}</ul>}
            </section>
            <section aria-labelledby="ops-follow-h" data-testid="ops-followups">
              <h3 id="ops-follow-h" className="mb-1 text-sm font-semibold">Follow-ups, with who they wait on ({followUps.length})</h3>
              {followUps.length === 0 ? <Muted>No other follow-up is open.</Muted> : <ul className="divide-y">{followUps.map((d) => <DecisionRow key={d.key} d={d} />)}</ul>}
            </section>
          </div>
        )}
      </Panel>

      <Panel id="next-on-site" className="scroll-mt-20" title={`Next on site (${nextSite.length})`}
        hint={<><p>Dated site activities from the Site schedule, each once, with the dates and the state of each. Activities whose date has passed with no recorded start come first: nobody has said they started, so they say so.</p><p className="mt-1.5">A date from a project header is listed only for a project with no dated site activity, and says it comes from the header. Sales enquiry dates are in the timeline below.</p></>}>
        <SitesNote sites={sites} />
        {nextSite.length === 0 ? <Muted>No site activity is dated today or in the next {NEXT_ON_SITE_DAYS} days, and none has a passed date waiting.</Muted> : (
          <ul className="divide-y" data-testid="ops-next-on-site">{nextSite.map((e) => <SiteRow key={e.key} e={e} />)}</ul>
        )}
      </Panel>

      <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Operations at a glance" data-testid="ops-summary">
        <li><OsStatCard href={`${self}#decisions`} label="Needs my decision" value={items.length} icon={ClipboardList} edge={items.length > 0 ? "amber" : "muted"} /></li>
        <li><OsStatCard href={`${self}#installations`} label={`Installations in the next ${AT_RISK_WINDOW_DAYS} days`} value={soon.length} icon={CalendarClock} edge="blue" /></li>
        <li><OsStatCard href={`${self}#equipment`} label="Equipment issues" value={issues.length} icon={PackageSearch} edge={issues.length > 0 ? "amber" : "muted"} /></li>
        <li>{up.state === "ok"
          ? <OsStatCard href={upcomingHref} label="Upcoming Sales work" value={up.data.length} icon={ShoppingBag} edge="cyan" />
          : <OsStatCard href={upcomingHref} label="Upcoming Sales work" value="—" hint={up.state === "error" ? "Could not be loaded" : "Not shown"} icon={ShoppingBag} edge="muted" />}</li>
      </ul>

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] xl:items-start">
        <Panel id="installations" className="scroll-mt-20 xl:col-start-1" title={`Next installations (${soon.length})`}
          hint={<p>Live projects whose installation or show date (from the project header) falls within {AT_RISK_WINDOW_DAYS} days, with the Project Manager, the health label and how much of the equipment request is reserved or sent. The site activities themselves are under Next on site.</p>}>
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
                    <span className="text-sm"><KindMark kind={p.by} /> <span className="font-medium">{dateText(p.start)}</span> <span className="text-muted-foreground">({inDays(p.in_days)} · project header)</span></span>
                    {r ? <ReadinessBar value={r} /> : <span className="text-[12.5px] text-muted-foreground">{p.equipment.length === 0 ? "No equipment request recorded" : "No equipment lines waiting to be reserved"}</span>}
                  </div>
                </li>
              ); })}
            </ul>
          )}
        </Panel>

        <Panel className="xl:col-start-2 xl:row-start-1" title={`Delivery timeline, next ${TIMELINE_DAYS} days`}
          hint={<><p>The rest of the next {TIMELINE_DAYS} days, in date order, with installation, show and dismantling of one project run or one enquiry under one row. Each site activity links to its row on the Site schedule.</p><p className="mt-1.5">Enquiries without a project yet carry Sales dates and are tentative until Sales confirms them or wins the enquiry. An enquiry that already has a project is listed only through the project.</p></>}>
          {up.state !== "ok" ? <p role="status" className="mb-2 text-[13px] text-[hsl(var(--os-amber))]">⚠ {up.state === "error" ? "Enquiry dates could not be loaded, so only project dates are shown." : "Enquiry dates are not shown."}</p> : null}
          {groups.length === 0 ? <Muted>No further dated activity, project date or Sales date falls in the next {TIMELINE_DAYS} days.</Muted> : (
            <ol className="space-y-3" data-testid="ops-timeline">
              {groups.map((g) => (
                <li key={g.key} className="rounded-md border p-2.5" data-testid={`ops-group-${g.key}`}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <Link href={g.href} className="min-w-0 break-words font-medium underline-offset-4 hover:underline">{g.title}</Link>
                    {g.source === "sales" ? <span className="rounded border border-dashed px-1 py-0.5 text-[11.5px] text-muted-foreground">{g.tentative ? "Tentative" : "Sales dates"}</span> : null}
                  </p>
                  <ul className="mt-1 space-y-1">{g.entries.map((e) => <SiteRow key={e.key} e={e} compact />)}</ul>
                </li>
              ))}
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
                    <span className="w-28 flex-none text-[13px] font-medium sm:w-36">{w.from && w.to && w.key !== "passed" ? <>{w.label.startsWith("Week of") ? dateText(w.from) : w.label}<span className="block text-[11.5px] font-normal text-muted-foreground">{dateRangeText(w.from, w.to)}</span></> : w.label}</span>
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
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><Badge variant="outline" className={cn(x.kind === "shortage" || x.kind === "release_failed" || x.kind === "overdue_return" ? "border-[hsl(var(--os-red)/0.55)] text-[hsl(var(--os-red))]" : "border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]")}>{EQUIPMENT_ISSUE_WORDS[x.kind]}</Badge><Link href={x.href} className="min-w-0 break-words font-medium underline-offset-4 hover:underline">{x.project}</Link>{x.code ? <Link href={x.href} className="font-mono text-[12.5px] text-accent underline-offset-4 hover:underline" data-testid={`ops-request-${x.code}`}>{x.code}</Link> : null}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{x.text} · <span className="text-foreground">With {x.owner}</span></p>
                  <p className="text-[13px]" data-testid={`ops-next-${x.key}`}><span className="text-muted-foreground">Next:</span> {x.next}</p>
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
          hint={<><p>People on two projects whose dates overlap, two confirmed crewed activities that overlap, and reviews past the task&apos;s date. Each overlap lists both commitments with their dates or times. Only what is recorded; it is not a capacity figure.</p><p className="mt-1.5">A person-level overlap needs both projects to have their dates and people recorded. The activity-level one cannot say which person is on both: check the Site schedule.</p></>}>
          {overlaps.length === 0 ? <Muted>Nothing recorded.</Muted> : (
            <ul className="space-y-2.5 text-[13px]" data-testid="ops-pressure">
              {overlaps.map((x) => (
                <li key={x.key} data-testid={x.commitments ? "ops-pressure-pair" : undefined}>
                  <Link href={x.href} className="underline-offset-4 hover:underline">{x.text}</Link>
                  {x.commitments ? (
                    <ul className="mt-1 space-y-0.5 border-l pl-3" aria-label="Both commitments">
                      {x.commitments.map((c, i) => (
                        <li key={i} data-testid="ops-commitment"><Link href={c.href} className="font-medium underline-offset-4 hover:underline">{c.title}</Link> <span className="text-muted-foreground">· {c.project} · {c.when}</span></li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
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

/** One decision or follow-up: the badge, what and why, who it waits on, and the one exact place to act. */
function DecisionRow({ d }: { d: DecisionItem }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0" data-testid={`ops-decision-${d.kind}`}>
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Badge variant="outline" className={cn(d.kind === "pm_unassigned" || d.kind === "at_risk_installation" ? "border-[hsl(var(--os-red)/0.55)] text-[hsl(var(--os-red))]" : "border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]")}>{DECISION_WORDS[d.kind]}</Badge>
          <span className="min-w-0 break-words font-medium">{d.title}</span>
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">{d.detail}</p>
        <p className="mt-1 text-[13px]"><span className="text-muted-foreground">{d.mine ? "Assigned to you" : "With"}</span>{d.mine ? null : <> <span className="font-medium">{d.owner}</span></>}{d.date ? <> <span className="text-muted-foreground">· since</span> {dateText(d.date)}</> : null}</p>
      </div>
      <Link href={d.href} className={cn(buttonVariants({ variant: d.kind === "pm_unassigned" || d.mine ? "default" : "outline", size: "sm" }), "flex-none")}>{d.action}</Link>
    </li>
  );
}

/** Why the site activity read is not the source of the dates below (not installed, failed, or cut at its limit). A failed read is never drawn as "nothing scheduled". */
function SitesNote({ sites }: { sites: OpsResult<SiteActivityRead[]> }) {
  if (sites.state === "ok") return sites.data.length >= SITE_ACTIVITY_LIMIT ? <p role="status" className="mb-2 text-[13px] text-[hsl(var(--os-amber))]">⚠ Only the first {SITE_ACTIVITY_LIMIT} dated activities are read. Open a project&apos;s Site schedule for the rest.</p> : null;
  return <p role="status" className="mb-2 text-[13px] text-[hsl(var(--os-amber))]" data-testid="ops-sites-fallback">⚠ {sites.state === "error" ? "Site activities could not be loaded" : sites.state === "denied" ? "Site activities are not shown to you" : "Site activities are not installed here yet"}, so the dates below come from the project headers and say so.</p>;
}

/** One dated entry (a site activity, a labelled project-header fallback, or a Sales date): kind, state in words, title, when, venue, who, and the exact link. A passed date says what is needed, never "started". */
function SiteRow({ e, compact = false }: { e: TimelineEntry; compact?: boolean }) {
  const testId = e.activityId ? `ops-activity-${e.activityId}` : `ops-entry-${e.key}`;
  const when = e.when ?? `${dateText(e.date)}${e.until && e.until !== e.date ? ` to ${dateText(e.until)}` : ""}`;
  return (
    <li className={cn("min-w-0 text-[13px]", !compact && "py-2.5 first:pt-0 last:pb-0")} data-testid={testId} data-source={e.source} data-passed={e.passed ? "1" : undefined}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <KindMark kind={e.kind} />
        <Link href={e.href} className="min-w-0 break-words font-medium underline-offset-4 hover:underline">{compact ? (e.activityTitle ?? e.statusLabel) : `${e.activityTitle ?? e.title}${e.activityTitle ? ` · ${e.title}` : ""}`}</Link>
        {e.runLabel && !compact ? <span className="text-muted-foreground">· {e.runLabel}</span> : null}
      </p>
      <p className={cn("mt-0.5", e.passed ? "text-[hsl(var(--os-amber))]" : e.started ? "text-[hsl(var(--os-green))]" : "text-muted-foreground")}>{e.passed ? "⚠ " : ""}{e.statusLabel} · {when}{e.venue ? ` · ${e.venue}` : ""} · {e.who}</p>
      {e.passed ? <p className="mt-0.5">Next: <Link href={e.href} className="underline-offset-4 hover:underline">record the start or move the date on the Site schedule</Link></p> : null}
    </li>
  );
}
