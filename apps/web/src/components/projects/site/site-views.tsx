import Link from "next/link";
import { OsBadge } from "@/components/os/pills";
import { Muted, Panel } from "@/components/projects/parts";
import { ActivityDialog, CrewDialog, QuickAddActivitiesDialog, ReadinessDialog, RemoveShipmentDialog, ShipmentDialog } from "@/components/projects/site/site-forms";
import type { Option } from "@/components/projects/delivery/delivery-forms";
import { barPosition, timelineScale, type TimelineScale } from "@/lib/projects/delivery-plan/insights";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_KIND_LABELS, activityDays, activityWhen, CREW_ROLE_LABELS, crewName, formatAt, legText, MISSING_LABELS, READY_LABELS, requestStateText, runGroups, shortDay, siteRange, dateOnly,
  type SiteActivity, type SiteSchedule, type SiteShipment,
} from "@/lib/projects/phase2/model";
import { dateText } from "@/lib/projects/format";

const KIND_BAR: Record<string, string> = { setup: "bg-[hsl(var(--os-info))] border-[hsl(var(--os-info))]", show: "bg-[hsl(var(--os-green))] border-[hsl(var(--os-green))]", dismantling: "bg-[hsl(var(--os-amber))] border-[hsl(var(--os-amber))]", mockup: "bg-muted-foreground border-muted-foreground", other: "bg-muted-foreground border-muted-foreground" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;

const StateBadge = ({ state }: { state: "tentative" | "confirmed" }) => <OsBadge tone={state === "confirmed" ? "green" : "amber"}>{state === "confirmed" ? "Confirmed" : "Tentative"}</OsBadge>;

function ActivityRow({ a, projectId, schedule, canEdit, members }: { a: SiteActivity; projectId: string; schedule: SiteSchedule; canEdit: boolean; members: (Option & { siteOnly?: boolean })[] }) {
  const crewByRole = a.crew.reduce<Record<string, string[]>>((o, c) => { (o[c.role] ??= []).push(crewName(c)); return o; }, {});
  const overlapNames = a.crew.filter((c) => (c.overlaps ?? 0) > 0).map((c) => c.name ?? "Someone");
  const calls = a.crew.filter((c) => c.call_at);
  return (
    <li id={`site-${a.id}`} className="scroll-mt-24 space-y-1 py-2.5" data-testid={`site-activity-${a.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1 basis-64">
          <p className="break-words text-sm"><span className="font-medium">{a.title}</span> <span className="text-[13px] text-muted-foreground">{a.kind ? ACTIVITY_KIND_LABELS[a.kind] : "Activity"}</span></p>
          <p className="break-words text-[13px] font-medium" data-testid={`site-when-${a.id}`}>{activityWhen(a, schedule.tz)}</p>
          <p className="break-words text-[13px] text-muted-foreground">{a.location ?? "No location"} · Owner {a.owner_name ?? "not named"}</p>
          {a.crew.length > 0 ? <p className="break-words text-[13px]" data-testid={`site-crew-text-${a.id}`}>{Object.entries(crewByRole).map(([r, n]) => `${CREW_ROLE_LABELS[r as keyof typeof CREW_ROLE_LABELS]}: ${n.join(", ")}`).join(" · ")}</p> : null}
          {calls.length > 0 ? <p className="break-words text-[13px] text-muted-foreground" data-testid={`site-calls-${a.id}`}>Call times: {calls.map((c) => `${c.name ?? "Someone"} ${formatAt(c.call_at!, c.call_tz ?? a.tz ?? schedule.tz)}`).join(" · ")}</p> : null}
          {overlapNames.length > 0 ? <p className="break-words text-[13px] font-medium text-[hsl(var(--os-red))]" role="status" data-testid={`site-crew-overlap-${a.id}`}>Already booked at this time: {overlapNames.join(", ")}. Another confirmed activity or booking overlaps.</p> : null}
          {a.ready && (a.ready.hardware !== "unknown" || a.ready.content !== "unknown" || a.ready.app !== "unknown" || a.ready.note) ? <p className="break-words text-[13px] text-muted-foreground" data-testid={`site-ready-${a.id}`}>Ready: hardware {READY_LABELS[a.ready.hardware].toLowerCase()}, content {READY_LABELS[a.ready.content].toLowerCase()}, app {READY_LABELS[a.ready.app].toLowerCase()}{a.ready.note ? ` · ${a.ready.note}` : ""}</p> : null}
          {a.notes ? <p className="break-words text-[13px] text-muted-foreground">{a.notes}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StateBadge state={a.state} />
          {canEdit ? <><CrewDialog projectId={projectId} activity={a} members={members} /><ReadinessDialog projectId={projectId} activity={a} /><ActivityDialog projectId={projectId} activity={a} members={members} tz={schedule.tz} /></> : null}
        </div>
      </div>
      {a.missing.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" data-testid={`site-missing-${a.id}`}>
          {a.missing.map((m) => (
            <span key={m} className="inline-flex items-center gap-1 font-medium text-[hsl(var(--os-amber))]">
              {MISSING_LABELS[m]}
              {canEdit ? (m === "crew" ? <CrewDialog projectId={projectId} activity={a} members={members} label="Assign crew" /> : <ActivityDialog projectId={projectId} activity={a} members={members} tz={schedule.tz} label={m === "date" ? "Add the date" : "Add the time"} triggerVariant="ghost" />) : null}
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

function ShipmentRow({ s, projectId, schedule, canEdit, activities, requests }: { s: SiteShipment; projectId: string; schedule: SiteSchedule; canEdit: boolean; activities: { id: string; name: string }[]; requests: { id: string; name: string }[] }) {
  const req = s.request;
  return (
    <li id={`ship-${s.id}`} className="scroll-mt-24 space-y-1 py-2.5" data-testid={`site-shipment-${s.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1 basis-64">
          <p className="break-words text-sm"><span className="font-medium">{s.label}</span>{s.carrier || s.reference ? <span className="text-[13px] text-muted-foreground"> · {[s.carrier, s.reference].filter(Boolean).join(" · ")}</span> : null}</p>
          <ul className="text-[13px]" data-testid={`ship-legs-${s.id}`}>
            <li>{legText("Departs", s.departs_at, s.departs_tz)}</li>
            <li className="font-medium">{legText("Arrives", s.arrives_at, s.arrives_tz)}</li>
            <li>{legText("Returns", s.returns_at, s.returns_tz)}</li>
          </ul>
          <p className="break-words text-[13px] text-muted-foreground">{s.activity_title ? `Supports ${s.activity_title}` : "Not linked to a setup"}{req ? <> · Equipment request <span className="font-mono">{req.code}</span>: <span data-testid={`ship-inventory-${s.id}`}>{requestStateText(req)}</span> <span>(from Inventory)</span></> : " · No equipment request linked"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StateBadge state={s.state} />
          {req ? <Link href={`/projects/${projectId}/equipment?request=${req.id}`} className="text-[13px] font-medium text-accent underline-offset-4 hover:underline">Open the request</Link> : null}
          {canEdit ? <><ShipmentDialog projectId={projectId} shipment={s} activities={activities} requests={requests} tz={schedule.tz} /><RemoveShipmentDialog projectId={projectId} shipment={s} /></> : null}
        </div>
      </div>
      {s.conflict ? <p role="alert" className="text-[13px] font-semibold text-[hsl(var(--os-red))]" data-testid={`ship-conflict-${s.id}`}>Arrives too late: it arrives after {s.conflict.setup_title} {s.conflict.setup_has_time ? "starts" : "begins (the day it is needed)"}. {legText("Arrival", s.arrives_at, s.arrives_tz)}; setup {s.conflict.setup_has_time ? "starts" : "is on"} {s.conflict.setup_has_time ? "" : ""}{s.conflict.setup_start.length > 10 ? `${dateText(s.conflict.setup_start.slice(0, 10))}` : dateText(s.conflict.setup_start)}.</p> : null}
      {s.missing.length > 0 && canEdit ? <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-[hsl(var(--os-amber))]">{s.missing.includes("arrival") ? "No expected arrival yet" : "No departure yet"} <ShipmentDialog projectId={projectId} shipment={s} activities={activities} requests={requests} tz={schedule.tz} label="Add the time" /></p> : null}
    </li>
  );
}

/** The Site schedule: what happens on site (separate runs of setup, show and dismantling), who works each, and the shipments, drawn from the same records the Work overview reads. */
export function SiteSchedulePanel({ projectId, schedule, canEdit, members, requests }: { projectId: string; schedule: SiteSchedule; canEdit: boolean; members: (Option & { siteOnly?: boolean })[]; requests: { id: string; name: string }[] }) {
  const acts = schedule.activities.filter((a) => a.status !== "cancelled");
  const activityChoices = acts.map((a) => ({ id: a.id, name: a.title }));
  const firstSetup = acts.find((a) => a.kind === "setup" && (a.start_date || a.starts_at));
  const firstSetupDay = firstSetup ? activityDays(firstSetup, schedule.tz).start : null;
  const differs = !!firstSetupDay && !!schedule.committed.install_start && firstSetupDay !== schedule.committed.install_start;
  return (
    <div id="site-schedule" className="space-y-4" data-testid="site-schedule">
      <Panel title="Site schedule" description="What happens on site and when equipment ships: setup, show and dismantling, run by run, with each run's crew and the shipments that supply it."
        actions={canEdit ? <><ActivityDialog projectId={projectId} members={members} tz={schedule.tz} triggerVariant="default" /><QuickAddActivitiesDialog projectId={projectId} members={members} /><ShipmentDialog projectId={projectId} activities={activityChoices} requests={requests} tz={schedule.tz} /></> : undefined}>
        <p className="mb-3 text-[13px] text-muted-foreground" data-testid="site-vs-plan">This is the <strong>Site schedule</strong>: where the team is and when equipment arrives. The <strong>work schedule</strong> (tasks, requirements and milestones) is under <Link href={`/projects/${projectId}/delivery?view=timeline`} className="underline underline-offset-2">Project Plan, Timeline</Link>. Equipment stays installed only while an activity says so: two runs are two separate records.</p>
        {differs ? <p className="mb-3 rounded-md border border-border px-3 py-2 text-[13px]" data-testid="site-committed-note">The first setup here starts {shortDay(firstSetupDay!)}, but the project&apos;s committed installation date is {dateText(schedule.committed.install_start)}. Changing the committed date is done on the project (Manage project), where equipment bookings are reviewed.</p> : null}
        {acts.length === 0 ? <Muted>No site activities yet. {canEdit ? "Add the setup, the show and the dismantling, or use Quick add for several at once. A date is enough: the time and the crew can follow." : "The Project Manager adds them."}</Muted> : runGroups(acts).map((g) => (
          <section key={g.run} aria-label={g.run} className="mb-3 last:mb-0" data-testid={`site-run-${g.run}`}>
            <h4 className="border-b border-border pb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{g.run}</h4>
            <ul className="divide-y divide-border/70">{g.activities.map((a) => <ActivityRow key={a.id} a={a} projectId={projectId} schedule={schedule} canEdit={canEdit} members={members} />)}</ul>
          </section>
        ))}
      </Panel>
      <Panel title={`Shipments (${schedule.shipments.length})`} description="Departure, expected arrival and return, each in its own time zone. Reservation, dispatch and return state is read from Inventory.">
        {schedule.shipments.length === 0 ? <Muted>No shipments recorded. {canEdit ? "Add one when equipment travels to site, especially from overseas." : ""}</Muted> : <ul className="divide-y divide-border/70">{schedule.shipments.map((s) => <ShipmentRow key={s.id} s={s} projectId={projectId} schedule={schedule} canEdit={canEdit} activities={activityChoices} requests={requests} />)}</ul>}
      </Panel>
    </div>
  );
}

/** The same records as bars: a labelled column per day on a short schedule, weekly labels on a long one; the names stay in view while it scrolls sideways; exact dates are written on every row. */
export function SiteTimelineStrip({ schedule, today }: { schedule: SiteSchedule; today: string }) {
  const range = siteRange(schedule);
  if (!range) return <Muted>Nothing on the site schedule has a date yet, so there is nothing to draw across.</Muted>;
  const scale: TimelineScale = timelineScale(range);
  const n = scale.days.length;
  const todayIdx = scale.days.indexOf(today);
  const cols = "grid-cols-[10rem_minmax(0,1fr)] sm:grid-cols-[16rem_minmax(0,1fr)]";
  const grid: React.CSSProperties = { backgroundImage: "linear-gradient(to right, hsl(var(--border) / 0.8) 1px, transparent 1px)", backgroundSize: `${((scale.mode === "day" ? 1 : 7) / n) * 100}% 100%` };
  const rows: { key: string; label: string; sub: string; when: string; start: string | null; end: string | null; kind: string; tentative: boolean; marker?: boolean }[] = [
    ...schedule.activities.filter((a) => a.status !== "cancelled").map((a) => { const d = activityDays(a, schedule.tz); return { key: a.id, label: a.title, sub: [a.run_label, a.location].filter(Boolean).join(" · "), when: activityWhen(a, schedule.tz), start: d.start, end: d.end, kind: a.kind ?? "other", tentative: a.state === "tentative" }; }),
    ...schedule.shipments.map((s) => ({ key: s.id, label: s.label, sub: s.activity_title ? `Supports ${s.activity_title}` : "Shipment", when: legText("Arrives", s.arrives_at, s.arrives_tz), start: s.departs_at ? dateOnly(s.departs_at, s.departs_tz ?? schedule.tz) : null, end: s.arrives_at ? dateOnly(s.arrives_at, s.arrives_tz ?? schedule.tz) : null, kind: "ship", tentative: s.state === "tentative", marker: true })),
  ];
  return (
    <div className="overflow-x-auto rounded-md border border-border" data-testid="site-timeline-scroll">
      <div className="min-w-[calc(10rem+var(--sc))] sm:min-w-[calc(16rem+var(--sc))]" style={{ "--sc": `${scale.widthPx}px` } as React.CSSProperties}>
        <div className={cn("grid border-b border-border bg-muted text-[12px] font-semibold text-muted-foreground", cols)}>
          <div className="sticky left-0 z-20 border-r border-border bg-muted px-3 py-2">Activity or shipment, with its dates</div>
          <div className="relative h-14">
            {scale.labels.map((l) => (
              <span key={l.date} data-testid={`site-col-${l.date}`} className="absolute inset-y-0 flex flex-col items-center justify-center border-l border-border/80 text-center leading-tight" style={{ left: `${(l.index / n) * 100}%`, width: scale.mode === "day" ? `${100 / n}%` : "auto", minWidth: scale.mode === "day" ? undefined : "4.5rem", alignItems: scale.mode === "day" ? "center" : "flex-start", paddingLeft: scale.mode === "day" ? 0 : "0.25rem" }}>
                {scale.mode === "day" ? <><span className="text-[11px] font-normal">{weekday(l.date)}</span><span className="text-[13px] text-foreground">{Number(l.date.slice(8, 10))}</span><span className="text-[11px] font-normal">{l.index === 0 || l.date.slice(8, 10) === "01" ? shortDay(l.date).split(" ")[1] : " "}</span></> : <span className="text-[12px] text-foreground">{shortDay(l.date)}</span>}
              </span>
            ))}
          </div>
        </div>
        <ul>
          {rows.map((r) => {
            const pos = barPosition(scale, r.start, r.end);
            return (
              <li key={r.key} className={cn("grid border-b border-border/70 last:border-b-0", cols)} data-testid={`site-tl-row-${r.key}`}>
                <div className="sticky left-0 z-10 min-w-0 border-r border-border bg-card px-3 py-2">
                  <p className="break-words text-sm font-medium">{r.label}</p>
                  {r.sub ? <p className="break-words text-[12px] text-muted-foreground">{r.sub}</p> : null}
                  <p className="break-words text-[13px]">{r.when}</p>
                </div>
                <div className="relative min-h-[3.5rem]" style={grid} role="img" aria-label={`${r.label}: ${r.when}`}>
                  {todayIdx >= 0 ? <span className="absolute inset-y-0 bg-[hsl(var(--os-red)/0.10)]" style={{ left: `${(todayIdx / n) * 100}%`, width: `${100 / n}%` }} aria-hidden title="Today" /> : null}
                  {pos ? <span data-testid={`site-bar-${r.key}`} data-start={r.start ?? ""} data-end={r.end ?? ""} className={cn("absolute top-1/2 -translate-y-1/2 rounded-sm border-2", r.marker ? "h-2 bg-transparent border-muted-foreground" : cn("h-4", KIND_BAR[r.kind]), r.tentative && !r.marker && "bg-transparent")} style={{ left: `calc(${pos.left}% + 1px)`, width: `calc(${pos.width}% - 2px)` }} /> : <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">No date</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
