"use client";

import { useMemo, useState } from "react";
import { Columns3, MapPin, Plus, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  COMPANIES, OPPORTUNITIES, SALES_USERS, STAGES, attention, dayDiff, fmtDate, fmtDay, fmtRange, fmtTime, isOpen, nextActionOf, personName, relDays, TODAY,
  type CompanyId, type Opportunity, type StageId,
} from "../../_lib/data";
import { PLink, usePreview } from "../../_components/context";
import { Chip, DueChip, OverdueBanner, PageHeader, StageChip, StateGate } from "../../_components/ui";
import { ClientLine, ValueText } from "../../_components/sales-bits";

type Quick = "all" | "overdue" | "today" | "awaiting" | "waiting" | "install-risk" | "install-30" | "no-dates";
type SortKey = "install" | "next" | "value" | "newest";
type ColId = "install" | "show" | "location" | "owner" | "value" | "next" | "company";
const COLS: { id: ColId; label: string; default: boolean }[] = [
  { id: "install", label: "Installation date", default: true }, { id: "show", label: "Show dates", default: true }, { id: "location", label: "Event location", default: true },
  { id: "owner", label: "Owner", default: true }, { id: "value", label: "Value", default: true }, { id: "next", label: "Next action", default: true }, { id: "company", label: "Company", default: false },
];
const QUICK: { value: Quick; label: string }[] = [
  { value: "all", label: "All opportunities" }, { value: "overdue", label: "Overdue follow-ups" }, { value: "today", label: "Follow-ups due today" }, { value: "awaiting", label: "Awaiting first response" },
  { value: "waiting", label: "Waiting for client" }, { value: "install-risk", label: "Installation soon, not fully confirmed" }, { value: "install-30", label: "Installation in the next 30 days" }, { value: "no-dates", label: "Dates not confirmed" },
];

function DateCell({ date, range }: { date: string | null; range?: { end: string | null } }) {
  if (!date) return <span className="text-muted-foreground">Dates not confirmed</span>;
  const n = dayDiff(date, TODAY);
  return (
    <div>
      <div className="whitespace-nowrap font-medium">{range ? fmtRange(date, range.end) : fmtDate(date)}</div>
      {!range ? <div className="text-xs text-muted-foreground">{n >= 0 ? relDays(date) : `${-n} days ago`}</div> : null}
    </div>
  );
}

export default function OpportunityList() {
  const { state, param } = usePreview();
  const initialQuick = (QUICK.find((q) => q.value === param("filter"))?.value ?? (state === "overdue" ? "overdue" : "all")) as Quick;
  const companyParam = param("company");
  const initialCompany = (companyParam && companyParam in COMPANIES ? companyParam : "all") as "all" | CompanyId;
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"all" | StageId>("all");
  const [owner, setOwner] = useState("all");
  const [company, setCompany] = useState<"all" | CompanyId>(initialCompany);
  const [quick, setQuick] = useState<Quick>(initialQuick);
  const [sort, setSort] = useState<SortKey>("install");
  const [cols, setCols] = useState<Set<ColId>>(new Set(COLS.filter((c) => c.default).map((c) => c.id)));
  const [colsOpen, setColsOpen] = useState(false);
  const show = (c: ColId) => cols.has(c);

  const a = useMemo(() => attention(), []);
  const ids = useMemo(() => ({
    overdue: new Set(a.overdue.map((f) => f.oppId)), today: new Set(a.dueToday.map((f) => f.oppId)), awaiting: new Set(a.awaitingFirstResponse.map((o) => o.id)),
    waiting: new Set(a.waitingForClient.map((o) => o.id)), risk: new Set(a.installRisks.map((o) => o.id)),
  }), [a]);

  const rows = OPPORTUNITIES.filter((o) => {
    if (quick === "overdue" && !ids.overdue.has(o.id)) return false;
    if (quick === "today" && !ids.today.has(o.id)) return false;
    if (quick === "awaiting" && !ids.awaiting.has(o.id)) return false;
    if (quick === "waiting" && !ids.waiting.has(o.id)) return false;
    if (quick === "install-risk" && !ids.risk.has(o.id)) return false;
    if (quick === "install-30" && !(isOpen(o) && o.installStart && dayDiff(o.installStart, TODAY) >= 0 && dayDiff(o.installStart, TODAY) <= 30)) return false;
    if (quick === "no-dates" && !(isOpen(o) && !o.installStart)) return false;
    if (stage !== "all" && o.stage !== stage) return false;
    if (owner !== "all" && o.owner !== owner) return false;
    if (company !== "all" && o.company !== company) return false;
    const hay = `${o.ref} ${o.title} ${o.agencyId ?? ""} ${o.endClientId ?? ""} ${o.location ?? ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  }).sort((x, y) => {
    if (sort === "install") return (x.installStart ?? "9999").localeCompare(y.installStart ?? "9999") || x.ref.localeCompare(y.ref);
    if (sort === "next") return (nextActionOf(x.id)?.dueAt ?? "9999").localeCompare(nextActionOf(y.id)?.dueAt ?? "9999");
    if (sort === "value") return (y.value ?? -1) - (x.value ?? -1);
    return y.createdAt.localeCompare(x.createdAt);
  });

  const toggleCol = (c: ColId) => setCols((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const nextCell = (o: Opportunity) => { const n = nextActionOf(o.id); return n ? (<><div>{n.title}</div><div className="mt-1 text-xs text-muted-foreground">{fmtDay(n.dueAt)}, {fmtTime(n.dueAt)}</div><div className="mt-1"><DueChip dueAt={n.dueAt} /></div></>) : <span className="text-muted-foreground">{o.stage === "won" ? "Closed: won" : o.stage === "lost" ? "Closed: lost" : "None"}</span>; };

  return (
    <>
      <PageHeader eyebrow="Sales & CRM" title="Opportunities" actions={<PLink href="/os-preview/sales/new" className={cn(buttonVariants({ size: "sm" }))}><Plus className="h-4 w-4" aria-hidden />New enquiry</PLink>} />
      <StateGate what="opportunities" emptyTitle="No opportunities yet" emptyText="Record an enquiry with five quick fields. Unknown dates, budget and scope are fine." emptyAction={<PLink href="/os-preview/sales/new" className={cn(buttonVariants({ size: "sm" }))}>New enquiry</PLink>}>
        {state === "overdue" || quick === "overdue" ? <OverdueBanner count={rows.length} /> : null}
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_14rem_11rem]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input aria-label="Search opportunities" placeholder="Search reference, title, client or place" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Show" value={quick} onChange={(e) => setQuick(e.target.value as Quick)}>{QUICK.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select>
          <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="install">Sort: Installation date</option><option value="next">Sort: Next action due</option><option value="value">Sort: Value</option><option value="newest">Sort: Newest</option>
          </Select>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select aria-label="Filter by stage" value={stage} onChange={(e) => setStage(e.target.value as "all" | StageId)} className="h-9 w-auto min-w-[9rem]"><option value="all">All stages</option>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          <Select aria-label="Filter by owner" value={owner} onChange={(e) => setOwner(e.target.value)} className="h-9 w-auto min-w-[9rem]"><option value="all">All owners</option>{SALES_USERS.map((p) => <option key={p} value={p}>{personName(p)}</option>)}</Select>
          <Select aria-label="Filter by company" value={company} onChange={(e) => setCompany(e.target.value as "all" | CompanyId)} className="h-9 w-auto min-w-[9rem]"><option value="all">All companies</option>{(Object.keys(COMPANIES) as CompanyId[]).map((c) => <option key={c} value={c}>{COMPANIES[c].name.replace(" (sample entity)", "")}</option>)}</Select>
          <div className="relative ml-auto hidden md:block">
            <Button type="button" variant="outline" size="sm" aria-expanded={colsOpen} onClick={() => setColsOpen((o) => !o)}><Columns3 className="h-4 w-4" aria-hidden />Columns</Button>
            {colsOpen ? (
              <div role="group" aria-label="Choose columns" className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-border bg-card p-3 shadow-xl">
                <p className="mb-2 text-xs text-muted-foreground">Opportunity and stage always show.</p>
                {COLS.map((c) => <label key={c.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={cols.has(c.id)} onChange={() => toggleCol(c.id)} />{c.label}</label>)}
                <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setColsOpen(false)}>Done</Button>
              </div>
            ) : null}
          </div>
        </div>
        <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">{rows.length} of {OPPORTUNITIES.length} opportunities</p>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Nothing matches. Clear a filter or search for something else.</p>
        ) : (
          <>
            <div className="relative hidden overflow-x-auto rounded-lg border border-border bg-card md:block" tabIndex={0} role="region" aria-label="Opportunities table">
              <table className="w-full min-w-[64rem] text-sm">
                <caption className="sr-only">Opportunities</caption>
                <thead className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">Opportunity</th><th scope="col" className="px-3 py-2.5 font-medium">Stage</th>
                    {show("install") ? <th scope="col" className="px-3 py-2.5 font-medium">Installation</th> : null}
                    {show("show") ? <th scope="col" className="px-3 py-2.5 font-medium">Show dates</th> : null}
                    {show("location") ? <th scope="col" className="px-3 py-2.5 font-medium">Location</th> : null}
                    {show("owner") ? <th scope="col" className="px-3 py-2.5 font-medium">Owner</th> : null}
                    {show("company") ? <th scope="col" className="px-3 py-2.5 font-medium">Company</th> : null}
                    {show("value") ? <th scope="col" className="px-3 py-2.5 text-right font-medium">Value</th> : null}
                    {show("next") ? <th scope="col" className="px-3 py-2.5 font-medium">Next action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className="border-b border-border/60 align-top last:border-0 hover:bg-secondary/30">
                      <td className="min-w-[15rem] max-w-[19rem] px-4 py-3">
                        <PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="break-words font-medium hover:underline">{o.title}</PLink>
                        <div className="text-xs text-muted-foreground">{o.ref} · <ClientLine o={o} /></div>
                      </td>
                      <td className="px-3 py-3"><StageChip stage={o.stage} />{o.waiting === "client" && o.stage !== "on_hold" ? <div className="mt-1"><Chip>Waiting for client</Chip></div> : null}</td>
                      {show("install") ? <td className="px-3 py-3"><DateCell date={o.installStart} /></td> : null}
                      {show("show") ? <td className="px-3 py-3"><DateCell date={o.eventStart} range={{ end: o.eventEnd }} /></td> : null}
                      {show("location") ? <td className="max-w-[11rem] px-3 py-3">{o.location ?? <span className="text-muted-foreground">Not recorded</span>}</td> : null}
                      {show("owner") ? <td className="whitespace-nowrap px-3 py-3">{personName(o.owner)}</td> : null}
                      {show("company") ? <td className="px-3 py-3">{COMPANIES[o.company].name.replace(" (sample entity)", "")}</td> : null}
                      {show("value") ? <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums"><ValueText o={o} /></td> : null}
                      {show("next") ? <td className="min-w-[11rem] px-3 py-3">{nextCell(o)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 md:hidden">
              {rows.map((o) => {
                const n = nextActionOf(o.id);
                return (
                  <li key={o.id} className="rounded-lg border border-border bg-card p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="min-w-0 break-words text-sm font-semibold hover:underline">{o.title}</PLink>
                      <StageChip stage={o.stage} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{o.ref} · <ClientLine o={o} /></p>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      <div><dt className="text-xs text-muted-foreground">Installation</dt><dd>{o.installStart ? fmtDate(o.installStart) : <span className="text-muted-foreground">Dates not confirmed</span>}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Show</dt><dd>{o.eventStart ? fmtRange(o.eventStart, o.eventEnd) : <span className="text-muted-foreground">Dates not confirmed</span>}</dd></div>
                      <div className="col-span-2"><dt className="text-xs text-muted-foreground">Location</dt><dd className="flex items-start gap-1 break-words"><MapPin className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />{o.location ?? "Not recorded"}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Owner</dt><dd>{personName(o.owner)}</dd></div>
                      <div><dt className="text-xs text-muted-foreground">Value</dt><dd className="font-medium tabular-nums"><ValueText o={o} /></dd></div>
                    </dl>
                    {n ? <div className="mt-3 border-t border-border/70 pt-2"><p className="text-sm">{n.title}</p><div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{fmtDay(n.dueAt)}, {fmtTime(n.dueAt)}</span><DueChip dueAt={n.dueAt} /></div></div> : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </StateGate>
    </>
  );
}
