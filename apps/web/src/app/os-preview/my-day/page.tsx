"use client";

import { ArrowRight, Flag, Plus, TriangleAlert, Wallet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FINANCE_SAMPLE, FOLLOWUPS, OPPORTUNITIES, PIPELINE_STAGES, attention, fmtDate, isOpen, money, nextActionOf, oppById, personName, stageLabel, type Currency,
} from "../_lib/data";
import { PROJECTS, SAMPLE_REQUESTS, TASKS, TEAM_PLAN, WEEK_DAYS } from "../_lib/delivery";
import { type RoleId } from "../_lib/modules";
import { PLink, usePreview } from "../_components/context";
import { Chip, DueChip, PageHeader, Panel, Stat, StageChip } from "../_components/ui";
import { HealthChip } from "../_components/delivery-bits";

function Greeting({ role }: { role: RoleId }) {
  const { roleDef } = usePreview();
  const first = roleDef.personLabel.split(" ")[0];
  return (
    <PageHeader
      eyebrow="Monday 19 October 2026"
      title={`Good morning, ${first}`}
      description={roleDef.description}
      actions={role === "sales" || role === "founder" ? <PLink href="/os-preview/sales/new" className={cn(buttonVariants({ size: "sm" }))}><Plus className="h-4 w-4" aria-hidden />New enquiry</PLink> : undefined}
    />
  );
}

function pipelineByCurrency() {
  const out: Record<Currency, { count: number; value: number }> = { AED: { count: 0, value: 0 }, SAR: { count: 0, value: 0 }, EUR: { count: 0, value: 0 } };
  for (const o of OPPORTUNITIES.filter(isOpen)) { out[o.currency].count += 1; out[o.currency].value += o.value ?? 0; }
  return out;
}

function FounderHome() {
  const a = attention();
  const pc = pipelineByCurrency();
  const open = OPPORTUNITIES.filter(isOpen);
  const decisions = [
    { id: "45", ref: "OPP-2026-0045", text: "Client asks for 30/70 payment terms instead of the standard 50/50.", owner: "daniel" },
    { id: "44", ref: "OPP-2026-0044", text: "Installation in 15 days and technology availability is still unverified.", owner: "amira" },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open opportunities" value={open.length} hint="Across all owning companies" href="/os-preview/sales/opportunities" />
        <Stat label="Overdue follow-ups" value={a.overdue.length} tone="bad" hint="Past the agreed date" href="/os-preview/sales/follow-ups" />
        <Stat label="Awaiting first response" value={a.awaitingFirstResponse.length} tone="warn" hint="No one has replied yet" href="/os-preview/sales" />
        <Stat label="Installs without confirmation" value={a.installNoConfirmation.length} tone="warn" hint="Within 21 days" href="/os-preview/sales" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Open pipeline value" description="Each currency is shown on its own line. They are never added together." className="lg:col-span-1">
          <dl className="space-y-3">
            {(Object.keys(pc) as Currency[]).map((c) => (
              <div key={c} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
                <dt className="text-sm text-muted-foreground">{c} · {pc[c].count} open</dt>
                <dd className="font-heading text-lg font-semibold">{pc[c].value.toLocaleString("en-US")}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Opportunities with no value yet are counted but add nothing. Sample data.</p>
        </Panel>

        <Panel title="Needs a founder" description="Items where a founder's decision unblocks the owner." className="lg:col-span-2">
          <ul className="divide-y divide-border/70">
            {decisions.map((d) => (
              <li key={d.ref} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <Flag className="mt-0.5 h-4 w-4 flex-none text-warning" aria-hidden />
                <div className="min-w-[12rem] flex-1">
                  <PLink href={`/os-preview/sales/opportunities/${d.ref}`} className="text-sm font-medium hover:underline">{d.ref} · {oppById(d.id).title}</PLink>
                  <p className="text-sm text-muted-foreground">{d.text}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Owner: {personName(d.owner)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Financial summary"
        description="Budget, committed, actual and forecast are different things; invoices and collections are different again."
        actions={<Chip tone="warn">Sample figures</Chip>} flush
      >
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Sample financial summary by project and currency</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">Project</th>
                {["Budget", "Committed", "Actual", "Forecast", "Invoiced", "Collected"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-right font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {FINANCE_SAMPLE.map((r) => (
                <tr key={r.project} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-medium">{r.project}<div className="text-xs font-normal text-muted-foreground">{r.currency}</div></th>
                  {[r.budget, r.committed, r.actual, r.forecast, r.invoiced, r.collected].map((n, i) => <td key={i} className="px-3 py-2.5 text-right tabular-nums">{n.toLocaleString("en-US")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-x-6 gap-y-1 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground sm:grid-cols-2">
          <p><strong className="text-foreground">Budget</strong>: approved spend plan. <strong className="text-foreground">Committed</strong>: ordered or promised. <strong className="text-foreground">Actual</strong>: paid or reconciled. <strong className="text-foreground">Forecast</strong>: expected total at completion.</p>
          <p><strong className="text-foreground">Invoiced</strong> and <strong className="text-foreground">Collected</strong> come from Zoho Books references recorded by hand; they are not calculated here. Real figures need Projects and Finance links, so today this panel would read <em>Not collecting data yet</em>.</p>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Pipeline by stage" description="Count of open opportunities (sample).">
          <ul className="space-y-2">
            {PIPELINE_STAGES.map((s) => {
              const n = open.filter((o) => o.stage === s).length;
              return (
                <li key={s} className="flex items-center gap-3 text-sm">
                  <span className="w-40 flex-none text-muted-foreground">{stageLabel(s)}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden><span className="block h-full rounded-full brand-gradient" style={{ width: `${(n / Math.max(1, open.length)) * 100}%` }} /></span>
                  <span className="w-6 text-right font-medium tabular-nums">{n}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Performance & KPIs" description="Targets and trends appear once data is being collected.">
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Not collecting data yet</p>
        </Panel>
      </div>
    </div>
  );
}

function SalesHome() {
  const a = attention();
  const mine = OPPORTUNITIES.filter((o) => o.owner === "amira" && isOpen(o));
  const myDue = FOLLOWUPS.filter((f) => !f.doneAt && f.owner === "amira" && f.due <= "2026-10-19");
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="My open opportunities" value={mine.length} href="/os-preview/sales/opportunities" />
        <Stat label="My follow-ups due or overdue" value={myDue.length} tone={myDue.length ? "bad" : "neutral"} href="/os-preview/sales/follow-ups" />
        <Stat label="Awaiting first response" value={a.awaitingFirstResponse.length} tone="warn" hint="Anyone's enquiry" href="/os-preview/sales" />
        <Stat label="Waiting for client" value={a.waitingForClient.length} hint="Nothing for us to do yet" href="/os-preview/sales/follow-ups" />
      </div>
      <Panel title="Do these first" description="Your follow-ups that are due today or overdue." flush>
        <ul className="divide-y divide-border/70">
          {myDue.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <DueChip due={f.due} />
              <div className="min-w-[12rem] flex-1">
                <p className="text-sm font-medium">{f.title}</p>
                <PLink href={`/os-preview/sales/opportunities/${oppById(f.oppId).ref}`} className="text-xs text-muted-foreground hover:underline">{oppById(f.oppId).ref} · {oppById(f.oppId).title}</PLink>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="My opportunities" flush>
        <ul className="divide-y divide-border/70">
          {mine.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <div className="min-w-[12rem] flex-1">
                <PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="text-sm font-medium hover:underline">{o.title}</PLink>
                <p className="text-xs text-muted-foreground">{o.ref} · next: {nextActionOf(o.id)?.title ?? "none"}</p>
              </div>
              <StageChip stage={o.stage} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function PmHome() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Projects I run" value={PROJECTS.length} />
        <Stat label="At risk or blocked" value={PROJECTS.filter((p) => p.health !== "on_track").length} tone="warn" />
        <Stat label="Handovers to accept" value={1} hint="Marked as design only" />
        <Stat label="Advances to request" value={1} />
      </div>
      <Panel title="My projects" description="Sorted by installation date." flush>
        <ul className="divide-y divide-border/70">
          {[...PROJECTS].sort((a, b) => a.install.localeCompare(b.install)).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <div className="min-w-[12rem] flex-1"><p className="text-sm font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.client} · install {fmtDate(p.install)}</p><p className="text-xs">{p.note}</p></div>
              <HealthChip h={p.health} />
            </li>
          ))}
        </ul>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Handover packages" description="Sales hands over; you accept (a later release).">
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">OPP-2026-0047 · Holographic display, expo stand</p>
            <p className="text-xs text-muted-foreground">Handover prepared 10 Oct 2026 by Amira Nasser. Commercially won. Not yet accepted by a PM.</p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">How a PM sees a package without Sales access is an open decision (see roadmap §13).</p>
        </Panel>
        <Panel title="Money and site" description="Advance requests and site reservations.">
          <ul className="space-y-2 text-sm">
            {SAMPLE_REQUESTS.advances.map((r) => <li key={r.project} className="flex items-start gap-2"><Wallet className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden /><div><p className="font-medium">{r.project}</p><p className="text-xs text-muted-foreground">{r.ask} · {r.status}</p></div></li>)}
            {SAMPLE_REQUESTS.reservations.map((r) => <li key={r.what} className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{r.what}</span><br />{r.when} · {r.who}<br />{r.note}</li>)}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function HeadHome() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="People in my team" value={TEAM_PLAN.length} />
        <Stat label="Double-booked days this week" value={TEAM_PLAN.flatMap((p) => p.days).filter((d) => d && d.length > 1).length} tone="warn" hint="Two projects on one day" />
        <Stat label="Blocked tasks" value={TASKS.filter((t) => t.status === "blocked").length} tone="bad" />
        <Stat label="Unassigned days" value={TEAM_PLAN.flatMap((p) => p.days).filter((d) => d === null).length} />
      </div>
      <Panel title="My team this week" description="Planned in days, not hours. Two projects on one day is a competing deadline.">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Programming team plan, Monday 19 to Friday 23 October 2026</caption>
            <thead><tr className="text-left text-xs text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Person</th>{WEEK_DAYS.map((d) => <th key={d} scope="col" className="px-2 py-2 font-medium">{d}</th>)}</tr></thead>
            <tbody>
              {TEAM_PLAN.map((p) => (
                <tr key={p.person} className="border-t border-border/60 align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">{p.person}</th>
                  {p.days.map((d, i) => (
                    <td key={i} className="px-2 py-2">
                      {d === null ? <span className="text-xs text-muted-foreground">Unassigned</span> : (
                        <div className="flex flex-col gap-1">
                          {d.map((x) => <span key={x} className="rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-xs">{x}</span>)}
                          {d.length > 1 ? <span className="flex items-center gap-1 text-[11px] font-semibold text-foreground"><TriangleAlert className="h-3 w-3" aria-hidden />Competing</span> : null}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Deadlines across projects" flush>
          <ul className="divide-y divide-border/70">
            {[...TASKS].filter((t) => t.dept === "Programming").sort((a, b) => a.due.localeCompare(b.due)).map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm"><div className="min-w-[12rem] flex-1"><p className="font-medium">{t.title}</p><p className="text-xs text-muted-foreground">{PROJECTS.find((p) => p.id === t.projectId)!.name} · {t.assignee}</p></div><span className="text-xs text-muted-foreground">{fmtDate(t.due)}</span></li>
            ))}
          </ul>
        </Panel>
        <Panel title="Blockers">
          <ul className="space-y-2 text-sm">
            <li><span className="font-medium">Touch calibration build</span> (Ibrahim Saad): waiting for client network access details.</li>
            <li><span className="font-medium">Show-control cue sheet</span>: needs approved content from Content team by 27 Oct.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function EmployeeHome() {
  const mine = TASKS.filter((t) => t.assignee === "Tariq Aziz");
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="My tasks" description="Across all my projects, soonest first." className="lg:col-span-2" flush>
          <ul className="divide-y divide-border/70">
            {[...mine].sort((a, b) => a.due.localeCompare(b.due)).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <div className="min-w-[12rem] flex-1"><p className="text-sm font-medium">{t.title}</p><p className="text-xs text-muted-foreground">{PROJECTS.find((p) => p.id === t.projectId)!.name}</p></div>
                <Chip tone={t.status === "doing" ? "info" : "neutral"}>{t.status === "doing" ? "In progress" : "To do"}</Chip>
                <DueChip due={t.due} />
              </li>
            ))}
          </ul>
        </Panel>
        <div className="space-y-6">
          <Panel title="Upcoming site work"><p className="text-sm font-medium">Expo install</p><p className="text-xs text-muted-foreground">Sun 8 Nov, 07:00–19:00. Recovery Leave rules for site work stay exactly as today.</p></Panel>
          <Panel title="My requests"><p className="text-sm text-muted-foreground">Leave, expenses and Recovery Leave live in People &amp; HR.</p><PLink href="/os-preview/people" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--os-link))] hover:underline">Open People &amp; HR <ArrowRight className="h-3.5 w-3.5" aria-hidden /></PLink></Panel>
        </div>
      </div>
    </div>
  );
}

export default function MyDayPage() {
  const { role } = usePreview();
  return (
    <>
      <Greeting role={role} />
      {role === "founder" ? <FounderHome /> : role === "sales" ? <SalesHome /> : role === "pm" ? <PmHome /> : role === "head" ? <HeadHome /> : <EmployeeHome />}
    </>
  );
}
