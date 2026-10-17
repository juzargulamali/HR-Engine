"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { FOLLOWUPS, OPPORTUNITIES, TODAY, attention, fmtDateTime, isOpen, oppById, personName, type FollowUp } from "../../_lib/data";
import { PLink, usePreview } from "../../_components/context";
import { Chip, DueChip, OverdueBanner, PageHeader, Panel, StateGate, useNotice } from "../../_components/ui";

type View = "overdue" | "today" | "upcoming" | "waiting" | "first" | "done";
const VIEWS: { value: View; label: string }[] = [
  { value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "upcoming", label: "Upcoming" },
  { value: "waiting", label: "Waiting for client" }, { value: "first", label: "Awaiting first response" }, { value: "done", label: "Completed" },
];

export default function FollowUps() {
  const { state } = usePreview();
  const [view, setView] = useState<View>("overdue");
  const [done, setDone] = useState<Record<string, string>>({});
  const { notify, node } = useNotice();
  const a = attention();
  const fus: FollowUp[] = FOLLOWUPS.map((f) => (done[f.id] ? { ...f, doneAt: done[f.id] } : f));
  const open = fus.filter((f) => !f.doneAt);
  const lists: Record<View, FollowUp[]> = {
    overdue: open.filter((f) => f.due < TODAY).sort((x, y) => x.due.localeCompare(y.due)),
    today: open.filter((f) => f.due === TODAY),
    upcoming: open.filter((f) => f.due > TODAY).sort((x, y) => x.due.localeCompare(y.due)),
    waiting: [], first: [], done: fus.filter((f) => f.doneAt),
  };
  const waiting = a.waitingForClient;
  const first = OPPORTUNITIES.filter((o) => isOpen(o) && !o.firstResponseAt);
  const counts: Record<View, number> = { overdue: lists.overdue.length, today: lists.today.length, upcoming: lists.upcoming.length, waiting: waiting.length, first: first.length, done: lists.done.length };

  return (
    <>
      <PageHeader eyebrow="Sales & CRM" title="Follow-ups and activities" description="The queue of things to do next. Each shows when it was scheduled and, once finished, when it was actually completed." />
      <StateGate what="follow-ups" emptyTitle="Nothing to follow up" emptyText="Follow-ups appear here when an opportunity has a next action.">
        {state === "overdue" || view === "overdue" ? (counts.overdue ? <OverdueBanner count={counts.overdue} /> : null) : null}
        <div className="-mx-1 mb-4 overflow-x-auto px-1" tabIndex={0} role="region" aria-label="Follow-up views">
          <SegmentedControl<View> aria-label="Follow-up view" value={view} onChange={setView} options={VIEWS.map((v) => ({ value: v.value, label: `${v.label} (${counts[v.value]})` }))} className="min-w-max" />
        </div>
        <Panel flush>
          {view === "waiting" ? (
            <ul className="divide-y divide-border/70">
              {waiting.map((o) => <li key={o.id} className="px-4 py-3"><PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="text-sm font-medium hover:underline">{o.title}</PLink><p className="text-xs text-muted-foreground">{o.ref} · Owner {personName(o.owner)} · We have replied; nothing for us to do until the client answers.</p></li>)}
            </ul>
          ) : view === "first" ? (
            <ul className="divide-y divide-border/70">
              {first.map((o) => <li key={o.id} className="flex flex-wrap items-center gap-2 px-4 py-3"><div className="min-w-[12rem] flex-1"><PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="text-sm font-medium hover:underline">{o.title}</PLink><p className="text-xs text-muted-foreground">{o.ref} · Logged {fmtDateTime(`${o.createdAt}T16:40`)} by {personName(o.createdBy)}</p></div><Chip tone="warn">Awaiting first response</Chip></li>)}
            </ul>
          ) : lists[view].length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing here. {view === "overdue" ? "Nothing is overdue." : ""}</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {lists[view].map((f) => (
                <li key={f.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
                  <div className="min-w-[12rem] flex-1">
                    <p className="text-sm font-medium">{f.title}</p>
                    <PLink href={`/os-preview/sales/opportunities/${oppById(f.oppId).ref}`} className="text-xs text-muted-foreground hover:underline">{oppById(f.oppId).ref} · {oppById(f.oppId).title}</PLink>
                    <p className="mt-0.5 text-xs text-muted-foreground">Owner {personName(f.owner)} · scheduled {fmtDateTime(f.scheduledAt)}{f.doneAt ? ` · completed ${fmtDateTime(f.doneAt)}` : ""}</p>
                  </div>
                  <DueChip due={f.due} done={f.doneAt} />
                  {!f.doneAt ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setDone((d) => ({ ...d, [f.id]: "2026-10-19T09:30" })); notify("Follow-up marked done"); }}>Mark done</Button> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <p className="mt-3 text-xs text-muted-foreground">Response targets and reminders are configured in Sales settings. None are set yet, so nothing here is marked “late” by a rule: overdue means past the date the owner chose.</p>
      </StateGate>
      {node}
    </>
  );
}
