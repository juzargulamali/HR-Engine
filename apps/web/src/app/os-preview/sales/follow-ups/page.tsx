"use client";

import { useState } from "react";
import { CalendarPlus, CheckCheck } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { FOLLOWUPS, NOW, OPPORTUNITIES, attention, fmtDateTime, fmtDue, isOpen, oppById, personName, type FollowUp, type Opportunity } from "../../_lib/data";
import { PLink, usePreview } from "../../_components/context";
import { CompleteFollowUpDialog, ScheduleNextDialog, type CompleteResult } from "../../_components/followup-dialogs";
import { Chip, Deadline, OverdueBanner, PageHeader, ScrollRow, StateGate, useNotice } from "../../_components/ui";
import { ClientLine } from "../../_components/sales-bits";

type View = "overdue" | "today" | "upcoming" | "waiting" | "first" | "done";
const VIEWS: { value: View; label: string }[] = [
  { value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "upcoming", label: "Upcoming" },
  { value: "waiting", label: "Waiting for client" }, { value: "first", label: "Awaiting first response" }, { value: "done", label: "Completed" },
];

export default function FollowUps() {
  const { state, roleDef, param } = usePreview();
  const [view, setView] = useState<View>((VIEWS.find((v) => v.value === param("view"))?.value ?? "overdue") as View);
  const [list, setList] = useState<FollowUp[]>(FOLLOWUPS);
  const [completing, setCompleting] = useState<FollowUp | null>(null);
  const [scheduling, setScheduling] = useState<Opportunity | null>(null);
  const { notify, node } = useNotice();
  const a = attention();
  const open = list.filter((f) => !f.doneAt);
  const by = (cmp: (f: FollowUp) => boolean) => open.filter(cmp).sort((x, y) => x.dueAt.localeCompare(y.dueAt));
  const lists: Record<View, FollowUp[]> = {
    overdue: by((f) => f.dueAt < NOW), today: by((f) => f.dueAt >= NOW && f.dueAt.slice(0, 10) === NOW.slice(0, 10)), upcoming: by((f) => f.dueAt.slice(0, 10) > NOW.slice(0, 10)),
    waiting: [], first: [], done: list.filter((f) => f.doneAt).sort((x, y) => y.doneAt!.localeCompare(x.doneAt!)),
  };
  const waiting = a.waitingForClient;
  const first = OPPORTUNITIES.filter((o) => isOpen(o) && !o.firstResponseAt);
  const counts: Record<View, number> = { overdue: lists.overdue.length, today: lists.today.length, upcoming: lists.upcoming.length, waiting: waiting.length, first: first.length, done: lists.done.length };
  const mine = (f: FollowUp) => roleDef.canAssignOwner || roleDef.person === oppById(f.oppId).owner;

  function onDone(f: FollowUp, r: CompleteResult) {
    setList((all) => {
      const done = all.map((x) => (x.id === f.id ? { ...x, doneAt: NOW, outcome: r.outcome } : x));
      return r.next.kind === "schedule" ? [...done, { id: `n${all.length}`, oppId: f.oppId, owner: f.owner, title: r.next.title, dueAt: r.next.dueAt, createdAt: NOW, kind: r.next.actionKind }] : done;
    });
    notify("Follow-up completed");
  }

  return (
    <>
      <PageHeader eyebrow="Sales & CRM" title="Follow-ups" help="Overdue means past the time the owner set. No response-time target is configured yet, so nothing is marked late by a rule." />
      <StateGate what="follow-ups" emptyTitle="Nothing to follow up" emptyText="Follow-ups appear here when an opportunity has a next action.">
        {(state === "overdue" || view === "overdue") && counts.overdue ? <OverdueBanner count={counts.overdue} /> : null}
        <ScrollRow label="follow-up views" className="mb-4">
          <SegmentedControl<View> aria-label="Follow-up view" value={view} onChange={setView} options={VIEWS.map((v) => ({ value: v.value, label: `${v.label} (${counts[v.value]})` }))} className="min-w-max" />
        </ScrollRow>
        {view === "waiting" ? (
          <ul className="space-y-3">
            {waiting.map((o) => <li key={o.id} className="rounded-lg border border-border bg-card p-3.5"><PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="text-sm font-semibold hover:underline">{o.title}</PLink><p className="text-xs text-muted-foreground">{o.ref} · <ClientLine o={o} /> · Owner {personName(o.owner)}</p><p className="mt-1 text-sm text-muted-foreground">We have replied. Nothing to do until the client answers.</p></li>)}
          </ul>
        ) : view === "first" ? (
          <ul className="space-y-3">
            {first.map((o) => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3.5"><div className="min-w-0"><PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="text-sm font-semibold hover:underline">{o.title}</PLink><p className="text-xs text-muted-foreground">{o.ref} · Logged {fmtDateTime(`${o.createdAt}T16:40`)} by {personName(o.createdBy)}</p></div><Chip tone="warn">Awaiting first response</Chip></li>)}
          </ul>
        ) : lists[view].length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{view === "overdue" ? "Nothing is overdue." : "Nothing here."}</p>
        ) : (
          <ul className="space-y-3">
            {lists[view].map((f) => {
              const o = oppById(f.oppId);
              return (
                <li key={f.id} className="rounded-lg border border-border bg-card p-3.5">
                  <p className="text-sm font-semibold">{f.title}</p>
                  <PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="text-xs text-muted-foreground hover:underline">{o.ref} · {o.title}</PLink>
                  <Deadline dueAt={f.dueAt} done={f.doneAt} className="mt-2" />
                  {f.doneAt && f.outcome ? <p className="mt-1 text-xs text-muted-foreground">Outcome: {f.outcome}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">Owner {personName(o.owner)}</p>
                  {!f.doneAt ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" disabled={!mine(f)} onClick={() => setCompleting(f)}><CheckCheck className="h-4 w-4" aria-hidden />Complete</Button>
                      <Button size="sm" variant="outline" disabled={!mine(f)} onClick={() => setScheduling(o)}><CalendarPlus className="h-4 w-4" aria-hidden />Schedule next action</Button>
                      {!mine(f) ? <span className="text-xs text-muted-foreground">Only {personName(o.owner).split(" ")[0]} or a founder can do this.</span> : null}
                    </div>
                  ) : null}
                  <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Details</summary><p className="mt-1">Created {fmtDateTime(f.createdAt)}{f.doneAt ? ` · Completed ${fmtDateTime(f.doneAt)}` : ` · ${fmtDue(f.dueAt)}`}</p></details>
                </li>
              );
            })}
          </ul>
        )}
      </StateGate>
      {completing ? <CompleteFollowUpDialog key={completing.id} opp={oppById(completing.oppId)} followUp={completing} open onClose={() => setCompleting(null)} onDone={(r) => onDone(completing, r)} /> : null}
      {scheduling ? <ScheduleNextDialog key={scheduling.id} opp={scheduling} open onClose={() => setScheduling(null)} onSave={(f) => { setList((all) => [...all, { id: `s${all.length}`, oppId: scheduling.id, owner: scheduling.owner, title: f.title, dueAt: f.dueAt, createdAt: NOW, kind: f.kind }]); notify("Next action scheduled"); }} /> : null}
      {node}
    </>
  );
}
