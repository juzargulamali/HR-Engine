"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, Flag, Plus, TriangleAlert, Wallet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  COMPANIES, FINANCE_SAMPLE, FOLLOWUPS, OPPORTUNITIES, PIPELINE_STAGES, SAMPLE_DATE_LONG, attention, commercialStatus, dueLabel, fmtDate, fmtDay, fmtRange, fmtTime, isOpen, money, nextActionOf, oppById, personName, stageLabel,
  type CompanyId, type Currency, type Opportunity,
} from "../_lib/data";
import { CAPACITY_CONCERNS, PROJECTS, SAMPLE_REQUESTS, TASKS, TEAM_PLAN, WEEK_DAYS, daysWithoutAllocation, type SampleTask } from "../_lib/delivery";
import { type RoleId } from "../_lib/modules";
import { PLink, usePreview } from "../_components/context";
import { AvailabilityChip, Chip, Deadline, DueChip, Hint, PageHeader, Panel, Stat, StageChip, ScrollHint } from "../_components/ui";
import { HealthChip } from "../_components/delivery-bits";

function Greeting({ role }: { role: RoleId }) {
  const { roleDef } = usePreview();
  const first = roleDef.personLabel.split(" ")[0];
  return (
    <PageHeader
      eyebrow={SAMPLE_DATE_LONG}
      title={`Good morning, ${first}`}
      description={roleDef.description}
      actions={role === "sales" || role === "founder" ? <PLink href="/os-preview/sales/new" className={cn(buttonVariants({ size: "sm" }))}><Plus className="h-4 w-4" aria-hidden />New enquiry</PLink> : undefined}
    />
  );
}

const CURRENCY_OF: Record<CompanyId, Currency> = { uae: "AED", ksa: "SAR", eu: "EUR" };

function Section({ n, title, count, link, children, note }: { n: number; title: string; count: number; link?: { href: string; label: string }; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <section aria-labelledby={`sec-${n}`} className="px-4 py-4 sm:px-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={`sec-${n}`} className="flex items-center gap-2 font-heading text-base font-semibold">
          <span aria-hidden className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-secondary text-xs font-semibold">{n}</span>{title}
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", count ? "bg-accent/15 text-foreground" : "bg-secondary text-muted-foreground")}>{count}</span>
          {note}
        </h2>
        {link ? <PLink href={link.href} className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--os-link))] hover:underline">{link.label}<ArrowRight className="h-3.5 w-3.5" aria-hidden /></PLink> : null}
      </div>
      {count === 0 ? <p className="py-2 text-sm text-muted-foreground">Nothing here.</p> : children}
    </section>
  );
}

function FounderHome() {
  const { param } = usePreview();
  const fromUrl = param("company");
  const [company, setCompany] = useState<"all" | CompanyId>((fromUrl && fromUrl in COMPANIES ? fromUrl : "all") as "all" | CompanyId);
  const inScope = (o: Opportunity) => company === "all" || o.company === company;
  const a = attention(inScope);
  const co = company === "all" ? "" : `&company=${company}`;
  const open = OPPORTUNITIES.filter((o) => isOpen(o) && inScope(o));
  const currencies = (company === "all" ? ["AED", "SAR", "EUR"] : [CURRENCY_OF[company]]) as Currency[];

  const decisions = [
    { id: "45", text: "The client wants 30% on order and 70% after the event. Our standard is 50/50." },
    { id: "48", text: "Won by email. Confirm the email is acceptable evidence and choose the Project Manager for handover." },
  ].filter((d) => inScope(oppById(d.id)));
  const responseRows = [
    ...a.overdue.map((f) => ({ key: f.id, opp: oppById(f.oppId), text: f.title, chip: <DueChip dueAt={f.dueAt} /> })),
    ...a.awaitingFirstResponse.map((o) => ({ key: `r${o.id}`, opp: o, text: "Enquiry logged, no first response yet", chip: <Chip tone="warn">Awaiting first response</Chip> })),
  ];
  const risks = PROJECTS.filter((p) => p.health !== "on_track");
  const rows = FINANCE_SAMPLE.filter((r) => company === "all" || r.currency === CURRENCY_OF[company]);
  const cols: { key: keyof (typeof FINANCE_SAMPLE)[number]; label: string; help: string }[] = [
    { key: "approvedBudget", label: "Approved budget", help: "The spending limit approved for the project." },
    { key: "committed", label: "Committed cost", help: "Orders and agreements placed. The cost is not incurred yet." },
    { key: "incurred", label: "Actual incurred cost", help: "Cost that has happened (goods received, service done), whether or not it has been paid. One expense counts once, even if a receipt, a card transaction and an accounting entry all describe it." },
    { key: "forecastFinal", label: "Forecast final cost", help: "The expected total cost when the project is finished." },
    { key: "invoiced", label: "Invoiced", help: "Amount billed to the customer in Zoho Books." },
    { key: "collections", label: "Customer collections", help: "Money received from the customer." },
    { key: "supplierPayments", label: "Supplier payments", help: "Money paid to suppliers. Can be less than the incurred cost." },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Company</span>
          <Select value={company} onChange={(e) => setCompany(e.target.value as "all" | CompanyId)} className="h-9 w-56">
            <option value="all">All companies</option>{(Object.keys(COMPANIES) as CompanyId[]).map((c) => <option key={c} value={c}>{COMPANIES[c].name.replace(" (sample entity)", "")}</option>)}
          </Select>
        </label>
        <Hint text="Currencies are never added together. Each one is shown on its own line." />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 divide-y divide-border rounded-lg border border-border bg-card lg:col-span-2">
          <Section n={1} title="Decisions for you" count={decisions.length}>
            <ul className="space-y-2.5">
              {decisions.map((d) => (
                <li key={d.id} className="flex items-start gap-2.5">
                  <Flag className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                  <div className="min-w-0"><PLink href={`/os-preview/sales/opportunities/${oppById(d.id).ref}`} className="break-words text-sm font-semibold hover:underline">{oppById(d.id).title}</PLink><p className="text-sm">{d.text}</p><p className="text-xs text-muted-foreground">{oppById(d.id).ref} · Owner {personName(oppById(d.id).owner)}</p></div>
                </li>
              ))}
            </ul>
          </Section>
          <Section n={2} title="Overdue follow-ups and enquiries awaiting a response" count={responseRows.length} link={{ href: `/os-preview/sales/follow-ups?view=overdue`, label: "All follow-ups" }}>
            <ul className="space-y-2.5">
              {responseRows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0"><PLink href={`/os-preview/sales/opportunities/${r.opp.ref}`} className="break-words text-sm font-semibold hover:underline">{r.opp.title}</PLink><p className="text-sm">{r.text}</p><p className="text-xs text-muted-foreground">Owner {personName(r.opp.owner)}</p></div>
                  {r.chip}
                </li>
              ))}
            </ul>
            <p className="mt-3 flex flex-wrap gap-x-4 text-sm"><PLink href={`/os-preview/sales/opportunities?filter=overdue${co}`} className="text-[hsl(var(--os-link))] hover:underline">Open overdue ({a.overdue.length})</PLink><PLink href={`/os-preview/sales/opportunities?filter=awaiting${co}`} className="text-[hsl(var(--os-link))] hover:underline">Open awaiting response ({a.awaitingFirstResponse.length})</PLink></p>
          </Section>
          <Section n={3} title="Installations coming up without full confirmation" count={a.installRisks.length} link={{ href: `/os-preview/sales/opportunities?filter=install-risk${co}`, label: "Open these" }}>
            <ul className="space-y-3">
              {a.installRisks.map((o) => (
                <li key={o.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <div className="min-w-0"><PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="break-words text-sm font-semibold hover:underline">{o.title}</PLink><p className="text-sm">Installation {fmtDate(o.installStart)}{o.eventStart ? ` · Show ${fmtRange(o.eventStart, o.eventEnd)}` : ""}</p><p className="text-xs text-muted-foreground">{o.location}</p></div>
                  <div className="flex flex-wrap gap-1.5"><Chip tone="neutral">{commercialStatus(o)}</Chip><AvailabilityChip o={o} /></div>
                </li>
              ))}
            </ul>
          </Section>
          <Section n={4} title="Project risks and blockers" count={risks.length} note={<Chip tone="info">Future module · sample</Chip>}>
            <ul className="space-y-2.5">
              {risks.map((p) => <li key={p.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"><div className="min-w-0"><p className="text-sm font-semibold">{p.name}</p><p className="text-sm">{p.note}</p><p className="text-xs text-muted-foreground">Install {fmtDate(p.install)} · PM {p.pm}</p></div><HealthChip h={p.health} /></li>)}
            </ul>
          </Section>
        </div>

        <Panel title="Open pipeline" description={company === "all" ? "One line per currency" : `${currencies[0]} only`} className="self-start">
          <dl className="space-y-3">
            {currencies.map((c) => { const l = open.filter((o) => o.currency === c); return (
              <div key={c} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0"><dt className="text-sm text-muted-foreground">{c} · {l.length} open</dt><dd className="font-heading text-lg font-semibold tabular-nums">{l.reduce((n, o) => n + (o.value ?? 0), 0).toLocaleString("en-US")}</dd></div>
            ); })}
          </dl>
          <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm">{PIPELINE_STAGES.map((s) => <li key={s} className="flex justify-between"><span className="text-muted-foreground">{stageLabel(s)}</span><span className="font-medium tabular-nums">{open.filter((o) => o.stage === s).length}</span></li>)}</ul>
          <PLink href={`/os-preview/sales/pipeline`} className="mt-3 inline-block text-sm font-medium text-[hsl(var(--os-link))] hover:underline">Open pipeline board</PLink>
        </Panel>
      </div>

      <details className="group rounded-lg border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="font-heading text-sm font-semibold">Financial summary <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">Future reporting example</span></span>
          <span className="flex items-center gap-2"><Chip tone="warn">Sample figures</Chip><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden /></span>
        </summary>
        <div className="border-t border-border">
          <ScrollHint />
          <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Financial summary table, scroll sideways">
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">Sample financial summary by project; each currency is separate</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="sticky left-0 min-w-[9rem] bg-card px-4 py-2 font-medium">Project</th>
                  {cols.map((c) => <th key={c.key} scope="col" className="px-3 py-2 text-right font-medium"><span className="inline-flex items-center justify-end gap-1">{c.label}<Hint text={c.help} align="right" label={`About ${c.label}`} /></span></th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.project} className="border-b border-border/60 last:border-0">
                    <th scope="row" className="sticky left-0 min-w-[9rem] bg-card px-4 py-2.5 text-left font-medium">{r.project}<div className="text-xs font-normal text-muted-foreground">{r.currency}</div></th>
                    {cols.map((c) => <td key={c.key} className="px-3 py-2.5 text-right font-medium tabular-nums">{(r[c.key] as number).toLocaleString("en-US")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 border-t border-border/70 px-4 py-3 text-sm sm:grid-cols-2">
            <div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Advances issued (cash given, not yet a cost)</h3><ul className="mt-1.5 space-y-1">{rows.filter((r) => r.advancesIssued > 0).map((r) => <li key={r.project} className="flex justify-between gap-3"><span>{r.project}</span><span className="tabular-nums">{money(r.advancesIssued, r.currency)}</span></li>)}{rows.every((r) => r.advancesIssued === 0) ? <li className="text-muted-foreground">None in this view.</li> : null}</ul></div>
            <p className="text-xs text-muted-foreground">Zoho Books stays the accounting source. These figures would start as manual references. Until real data exists this section reads “Not collecting data yet”.</p>
          </div>
        </div>
      </details>
    </div>
  );
}

function SalesHome() {
  const a = attention();
  const mine = OPPORTUNITIES.filter((o) => o.owner === "amira" && isOpen(o));
  const myDue = FOLLOWUPS.filter((f) => !f.doneAt && f.owner === "amira" && (dueLabel(f.dueAt).startsWith("Overdue") || dueLabel(f.dueAt) === "Due today")).sort((x, y) => x.dueAt.localeCompare(y.dueAt));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="My follow-ups due or overdue" value={myDue.length} tone={myDue.length ? "bad" : "neutral"} href="/os-preview/sales/follow-ups?view=overdue" />
        <Stat label="My open opportunities" value={mine.length} href="/os-preview/sales/opportunities" />
        <Stat label="Awaiting first response" value={a.awaitingFirstResponse.length} tone="warn" hint="Anyone's enquiry" href="/os-preview/sales/opportunities?filter=awaiting" />
        <Stat label="Waiting for client" value={a.waitingForClient.length} href="/os-preview/sales/opportunities?filter=waiting" />
      </div>
      <Panel title="Do these first" flush>
        <ul className="divide-y divide-border/70">
          {myDue.map((f) => (
            <li key={f.id} className="px-4 py-3">
              <p className="text-sm font-semibold">{f.title}</p>
              <PLink href={`/os-preview/sales/opportunities/${oppById(f.oppId).ref}`} className="text-xs text-muted-foreground hover:underline">{oppById(f.oppId).ref} · {oppById(f.oppId).title}</PLink>
              <Deadline dueAt={f.dueAt} className="mt-1.5" />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="My opportunities" flush>
        <ul className="divide-y divide-border/70">
          {mine.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <div className="min-w-[12rem] flex-1"><PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="break-words text-sm font-semibold hover:underline">{o.title}</PLink>
                <p className="text-xs text-muted-foreground">{o.installStart ? `Installation ${fmtDate(o.installStart)}` : "Dates not confirmed"} · {o.location ?? "Location not recorded"}</p>
                <p className="text-xs text-muted-foreground">Next: {nextActionOf(o.id)?.title ?? "none"}{nextActionOf(o.id) ? `, ${fmtDay(nextActionOf(o.id)!.dueAt)} ${fmtTime(nextActionOf(o.id)!.dueAt)}` : ""}</p></div>
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
        <Stat label="Handovers to accept" value={1} />
        <Stat label="Advances to request" value={1} />
      </div>
      <Panel title="My projects" description="Soonest installation first. Sample information." flush>
        <ul className="divide-y divide-border/70">
          {[...PROJECTS].sort((a, b) => a.install.localeCompare(b.install)).map((p) => (
            <li key={p.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 text-sm font-semibold">{p.name}</p><HealthChip h={p.health} /></div>
              <p className="text-xs text-muted-foreground">{p.client} · installation {fmtDate(p.install)}</p><p className="mt-0.5 text-sm">{p.note}</p>
            </li>
          ))}
        </ul>
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Handover packages" help="Sales prepares the package; you accept it in a later release. How a PM sees it without Sales access is still to be decided.">
          <div className="rounded-md border border-border p-3 text-sm"><p className="font-semibold">Holographic display, expo stand</p><p className="text-xs text-muted-foreground">Prepared 10 Oct 2026 by Amira Nasser. Waiting for a PM to accept.</p></div>
        </Panel>
        <Panel title="Money and site" description="Sample information.">
          <ul className="space-y-2 text-sm">
            {SAMPLE_REQUESTS.advances.map((r) => <li key={r.project} className="flex items-start gap-2"><Wallet className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden /><div><p className="font-medium">{r.project}</p><p className="text-xs text-muted-foreground">{r.ask} · {r.status}</p></div></li>)}
            {SAMPLE_REQUESTS.reservations.map((r) => <li key={r.what} className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{r.what}</span><br />{r.when} · {r.who}</li>)}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function HeadHome() {
  const mine = TASKS.filter((t) => t.dept === "Programming");
  const overdue = mine.filter((t) => t.status !== "done" && t.due < "2026-10-19");
  const blocked = mine.filter((t) => t.status === "blocked");
  const attentionCount = overdue.length + blocked.length + CAPACITY_CONCERNS.length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="People in my team" value={TEAM_PLAN.length} />
        <Stat label="Overdue tasks" value={overdue.length} tone={overdue.length ? "bad" : "neutral"} />
        <Stat label="Blocked tasks" value={blocked.length} tone={blocked.length ? "bad" : "neutral"} />
        <Stat label="Concerns raised" value={CAPACITY_CONCERNS.length} tone={CAPACITY_CONCERNS.length ? "warn" : "neutral"} hint="Raised by a person" />
      </div>

      {attentionCount ? (
        <Panel title="Needs your attention" flush>
          <ul className="divide-y divide-border/70">
            {overdue.map((t) => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><div><p className="text-sm font-semibold">{t.title}</p><p className="text-xs text-muted-foreground">{PROJECTS.find((p) => p.id === t.projectId)!.name} · {t.assignee}</p></div><TaskDue t={t} /></li>)}
            {blocked.map((t) => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><div><p className="text-sm font-semibold">{t.title}</p><p className="text-xs text-muted-foreground">{PROJECTS.find((p) => p.id === t.projectId)!.name} · {t.assignee} · waiting for client network access details</p></div><Chip tone="bad" icon={TriangleAlert}>Blocked</Chip></li>)}
            {CAPACITY_CONCERNS.map((c) => <li key={c.id} className="px-4 py-3"><p className="text-sm">{c.text}</p><p className="text-xs text-muted-foreground">Raised by {c.raisedBy}</p></li>)}
          </ul>
        </Panel>
      ) : null}

      <Panel title="My team this week" help="Planned in days, not hours. Several projects on one day is normal for office work and is not a warning. A blank day only means no allocation is recorded; it does not mean idle or absent." description={`${daysWithoutAllocation()} days have no recorded project allocation.`}>
        <ScrollHint />
        <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Team plan, scroll sideways">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Team plan, Monday 19 to Friday 23 October 2026</caption>
            <thead><tr className="text-left text-xs text-muted-foreground"><th scope="col" className="sticky left-0 min-w-[7.5rem] bg-card py-2 pr-3 font-medium">Person</th>{WEEK_DAYS.map((d) => <th key={d} scope="col" className="px-2 py-2 font-medium">{d}</th>)}</tr></thead>
            <tbody>
              {TEAM_PLAN.map((p) => (
                <tr key={p.person} className="border-t border-border/60 align-top">
                  <th scope="row" className="sticky left-0 min-w-[7.5rem] bg-card py-2 pr-3 text-left font-medium">{p.person}<div className="text-xs font-normal text-muted-foreground">{p.title}</div></th>
                  {p.days.map((d, i) => (
                    <td key={i} className="px-2 py-2">
                      {d.length === 0 ? <span className="text-xs text-muted-foreground">No allocation recorded</span> : (
                        <div className="flex flex-col gap-1">
                          {d.map((x) => <span key={x.project} className="rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-xs">{x.project}<span className="text-muted-foreground"> · {x.type}</span></span>)}
                          {d.length > 1 ? <span className="text-xs text-muted-foreground">Multiple project assignments</span> : null}
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

      <Panel title="Deadlines" flush>
        <ul className="divide-y divide-border/70">
          {[...mine].sort((a, b) => a.due.localeCompare(b.due)).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"><div className="min-w-[12rem] flex-1"><p className="font-medium">{t.title}</p><p className="text-xs text-muted-foreground">{PROJECTS.find((p) => p.id === t.projectId)!.name} · {t.assignee}</p></div><TaskDue t={t} /></li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** Task deadlines are dates; the label comes from the same sample clock as everything else. */
function TaskDue({ t }: { t: SampleTask }) {
  if (t.status === "done") return <Chip tone="good">Done</Chip>;
  return <span className="flex flex-wrap items-center gap-2 text-sm"><span>{fmtDay(t.due)}</span><DueChip dueAt={`${t.due}T23:59`} /></span>;
}

function EmployeeHome() {
  const mine = TASKS.filter((t) => t.assignee === "Tariq Aziz");
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="My tasks" description="Soonest first." className="lg:col-span-2" flush>
          <ul className="divide-y divide-border/70">
            {[...mine].sort((a, b) => a.due.localeCompare(b.due)).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <div className="min-w-[12rem] flex-1"><p className="text-sm font-semibold">{t.title}</p><p className="text-xs text-muted-foreground">{PROJECTS.find((p) => p.id === t.projectId)!.name}</p></div>
                <Chip tone={t.status === "doing" ? "info" : "neutral"}>{t.status === "doing" ? "In progress" : "To do"}</Chip>
                <TaskDue t={t} />
              </li>
            ))}
          </ul>
        </Panel>
        <div className="space-y-6">
          <Panel title="Upcoming site work"><p className="text-sm font-semibold">Expo install</p><p className="text-sm text-muted-foreground">Sun 8 Nov, 7:00 am to 7:00 pm. Recovery Leave rules for site work are unchanged.</p></Panel>
          <Panel title="My requests"><p className="text-sm text-muted-foreground">Leave, expenses and Recovery Leave are in People &amp; HR.</p><PLink href="/os-preview/people" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--os-link))] hover:underline">Open People &amp; HR <ArrowRight className="h-3.5 w-3.5" aria-hidden /></PLink></Panel>
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
