"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, Flag, MapPin, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelLink } from "@/components/workspace/panel-link";
import { SidePanel } from "@/components/workspace/side-panel";
import { withParams } from "@/components/workspace/url-state";
import { TODAY, TZ, TZ_LABEL, daysBetween, fmtDate, fmtDay, personFirst, personName, type Project, type Task, type TimelineItem } from "../_lib/sample";
import { siteClashFor } from "../_lib/logic";
import { useConcept } from "../_lib/store";
import { AttentionNote, Badge, EmptyNote, Notice, TaskStatusBadge } from "./bits";

const KIND = { milestone: { label: "Milestone", Icon: Flag }, deliverable: { label: "Deliverable", Icon: Package }, site: { label: "Site booking", Icon: MapPin } } as const;
const late = (i: TimelineItem) => i.kind !== "site" && !i.done && i.date < TODAY;

function timeWords(i: TimelineItem) {
  return i.startTime && i.endTime ? `${i.startTime}–${i.endTime}` : null;
}

export function TimelineView({ project, tasks, items, here }: { project: Project; tasks: Task[]; items: TimelineItem[]; here: string }) {
  const { persona, notify, href } = useConcept();
  const sp = useSearchParams();
  const pathname = usePathname();
  const aud = sp.get("aud") ?? "";
  const msId = sp.get("ms");
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const shown = sorted.filter((i) => (aud === "client" ? i.clientFacing : aud === "internal" ? !i.clientFacing : true));
  const firstFuture = shown.findIndex((i) => i.date >= TODAY);
  const open = items.find((i) => i.id === msId) ?? null;
  const patch = (a: string) => withParams(pathname, sp, { aud: a || null });
  const msHref = (id: string) => withParams(pathname, sp, { ms: id, task: null, eq: null });

  if (items.length === 0) return <EmptyNote title="No dates yet">This sample project has no milestones or deliverables.</EmptyNote>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Audience" className="inline-flex gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5">
          {([["", "All"], ["client", "Client-facing"], ["internal", "Internal"]] as const).map(([v, label]) => (
            <Link key={v} href={patch(v)} scroll={false} aria-current={aud === v ? "page" : undefined} className={`inline-flex h-8 items-center rounded-[5px] px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${aud === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</Link>
          ))}
        </nav>
        <p className="text-sm text-muted-foreground">Deadlines are dates. Site bookings have times in {TZ_LABEL}.</p>
      </div>

      <ol className="mt-4 space-y-2" aria-label="Milestones, deliverables and site bookings">
        {shown.map((i, idx) => {
          const K = KIND[i.kind];
          const clash = siteClashFor(i, persona);
          const days = daysBetween(i.date, TODAY);
          return (
            <Fragment key={i.id}>
              {idx === firstFuture ? <li aria-label="Today" className="flex items-center gap-3 py-1 text-[13px] font-semibold text-accent"><span className="h-px flex-1 bg-primary/50" aria-hidden />Today · {fmtDay(TODAY)}<span className="h-px flex-1 bg-primary/50" aria-hidden /></li> : null}
              <li className={`relative grid gap-x-4 rounded-lg bg-card p-3.5 sm:grid-cols-[7.5rem_1fr] ${open?.id === i.id ? "ring-2 ring-primary" : ""} ${i.kind === "site" ? "border-l-4 border-l-[hsl(var(--cx-info))]" : ""}`}>
                <div className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{fmtDay(i.date)}</span>{timeWords(i) ? <span className="block">{timeWords(i)}</span> : null}</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <K.Icon className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                    <PanelLink href={msHref(i.id)} className="rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{i.title}</PanelLink>
                    <Badge tone="quiet">{K.label}</Badge>
                    <Badge tone={i.clientFacing ? "cyan" : "neutral"}>{i.clientFacing ? "Client-facing" : "Internal"}</Badge>
                    {i.done ? <Badge tone="quiet"><Check className="h-3.5 w-3.5" aria-hidden />Done</Badge> : late(i) ? <Badge tone="amber">Overdue by {days} {days === 1 ? "day" : "days"}</Badge> : null}
                  </div>
                  {i.kind === "site" ? <p className="mt-1 text-sm text-muted-foreground">{timeWords(i)} · {i.tz} (UTC+4) · {i.owner}</p> : <p className="mt-1 text-sm text-muted-foreground">{i.owner}</p>}
                  {clash ? (
                    <p className="mt-2 rounded-md bg-[hsl(var(--cx-amber)/0.12)] px-3 py-2 text-sm">
                      <span className="font-semibold text-[hsl(var(--cx-amber))]">Overlapping site booking.</span> {personName(clash.who)} is also booked for {clash.other} that afternoon. Overlap with travel and preparation: {clash.minutes / 60} h.
                    </p>
                  ) : null}
                </div>
              </li>
            </Fragment>
          );
        })}
        {shown.length === 0 ? <li><EmptyNote title="Nothing in this view">No dates match “{aud === "client" ? "Client-facing" : "Internal"}”.</EmptyNote></li> : null}
      </ol>

      {open ? (
        <SidePanel title={open.title} subtitle={`${project.ref} · ${KIND[open.kind].label}`} closeHref={withParams(pathname, sp, {}, ["ms"])}>
          <div className="space-y-5 text-sm">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div><dt className="text-muted-foreground">{open.kind === "site" ? "Date" : "Deadline"}</dt><dd>{fmtDate(open.date)}</dd></div>
              {timeWords(open) ? <div><dt className="text-muted-foreground">Time</dt><dd>{timeWords(open)} · {open.tz ?? TZ} (UTC+4)</dd></div> : null}
              <div><dt className="text-muted-foreground">Seen by</dt><dd>{open.clientFacing ? "The client and the team" : "The team only"}</dd></div>
              <div><dt className="text-muted-foreground">Owner</dt><dd>{open.owner}</dd></div>
              <div><dt className="mb-0.5 text-muted-foreground">State</dt><dd>{open.done ? <Badge tone="quiet"><Check className="h-3.5 w-3.5" aria-hidden />Done</Badge> : late(open) ? <Badge tone="amber">Overdue by {daysBetween(open.date, TODAY)} days</Badge> : <Badge>Upcoming</Badge>}</dd></div>
            </dl>
            <p className="text-muted-foreground">{open.note}</p>
            {open.kind === "site" ? <Notice>A booking is a block of time on site. Only an overlap with another site booking, with travel and preparation included, is a clash. Several office tasks on one day never are.</Notice> : null}
            <section aria-label="Related tasks">
              <h3 className="mb-2 font-heading text-sm font-semibold">Tasks for this date</h3>
              {tasks.filter((t) => t.milestoneId === open.id).length ? (
                <ul className="divide-y divide-border/60 rounded-lg bg-secondary/40">
                  {tasks.filter((t) => t.milestoneId === open.id).map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <PanelLink href={href(here, { task: t.id, ms: null, tab: "timeline" })} className="min-w-0 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="block truncate">{t.title}</span><span className="text-[13px] text-muted-foreground">{personFirst(t.assignee)}</span></PanelLink>
                      <TaskStatusBadge status={t.status} />
                    </li>
                  ))}
                </ul>
              ) : <p className="text-muted-foreground">No tasks are tied to this date.</p>}
            </section>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => notify("info", "Changing a date is not part of this concept. In the live app a date change never moves dependent tasks by itself: a person decides each one.")}>Change date</Button>
              {late(open) ? <AttentionNote tone="warn">Dependent tasks keep their own dates.</AttentionNote> : null}
            </div>
          </div>
        </SidePanel>
      ) : null}
    </div>
  );
}
