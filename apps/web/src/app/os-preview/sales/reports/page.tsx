"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import {
  COMPANIES, FOLLOWUPS, OPPORTUNITIES, PIPELINE_STAGES, SALES_USERS, SAMPLE_PERIOD, ZOHO, fmtDate, isOpen, personName, stageLabel, type CompanyId, type Currency, type Opportunity,
} from "../../_lib/data";
import { usePreview } from "../../_components/context";
import { Chip, PageHeader, Panel, Restriction, StateGate } from "../../_components/ui";

type Scope = "all" | CompanyId;
const CURRENCIES: Currency[] = ["AED", "SAR", "EUR"];
const fmt = (n: number) => n.toLocaleString("en-US");

function ValueCells({ list, currencies }: { list: Opportunity[]; currencies: Currency[] }) {
  return <>{currencies.map((c) => <td key={c} className="px-3 py-2 text-right tabular-nums">{fmt(list.filter((o) => o.currency === c).reduce((n, o) => n + (o.value ?? 0), 0))}</td>)}</>;
}
function SampleNote({ n, what }: { n: number; what: string }) {
  return <p className="mt-2 text-xs text-muted-foreground">n = {n} {what} · period {fmtDate(SAMPLE_PERIOD.from)} to {fmtDate(SAMPLE_PERIOD.to)} · sample data</p>;
}

export default function Reports() {
  const { roleDef } = usePreview();
  const [scope, setScope] = useState<Scope>(roleDef.crossCompany ? "all" : "uae");
  const inScope = (o: Opportunity) => scope === "all" || o.company === scope;
  const currencies = scope === "all" ? CURRENCIES : [COMPANIES[scope].currency];
  const all = OPPORTUNITIES.filter(inScope);
  const open = all.filter(isOpen);
  const won = all.filter((o) => o.stage === "won");
  const lost = all.filter((o) => o.stage === "lost");
  const fus = FOLLOWUPS.filter((f) => inScope(OPPORTUNITIES.find((o) => o.id === f.oppId)!));
  const responded = all.filter((o) => o.firstResponseAt);
  const hours = responded.map((o) => (Date.parse(o.firstResponseAt!) - Date.parse(`${o.createdAt}T09:00`)) / 3600000).sort((a, b) => a - b);
  const median = hours.length ? hours[Math.floor(hours.length / 2)]! : null;
  const completed = fus.filter((f) => f.doneAt);
  const onTime = completed.filter((f) => f.doneAt!.slice(0, 10) <= f.due).length;
  const reasons = [...new Set(lost.map((o) => o.lostReason!))].map((r) => ({ r, n: lost.filter((o) => o.lostReason === r).length }));
  const th = "px-3 py-2 text-right font-medium";

  return (
    <>
      <PageHeader eyebrow="Sales & CRM" title="Sales reports" description="Every figure shows its period and how many records it is based on. Currencies are never added together." />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Company</span>
          <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="h-9 w-56">
            <option value="all" disabled={!roleDef.crossCompany}>All companies{roleDef.crossCompany ? "" : " (not available to you)"}</option>
            {(Object.keys(COMPANIES) as CompanyId[]).map((c) => <option key={c} value={c}>{COMPANIES[c].name.replace(" (sample entity)", "")}</option>)}
          </Select>
        </label>
        <Chip>Period: {fmtDate(SAMPLE_PERIOD.from)} to {fmtDate(SAMPLE_PERIOD.to)} (sample)</Chip>
        {!roleDef.crossCompany ? <Restriction>Cross-company totals are limited to authorised founders.</Restriction> : null}
      </div>
      <StateGate what="Sales reports" emptyTitle="Not enough data yet" emptyText="Reports appear once opportunities have been recorded for a period.">
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Open pipeline by stage" description={`Count and value. ${scope === "all" ? "One column per currency." : ""}`} flush>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Open pipeline by stage table"><table className="w-full text-sm"><caption className="sr-only">Open pipeline by stage</caption>
              <thead><tr className="border-b border-border text-xs text-muted-foreground"><th scope="col" className="px-4 py-2 text-left font-medium">Stage</th><th scope="col" className={th}>Open</th>{currencies.map((c) => <th key={c} scope="col" className={th}>{c}</th>)}</tr></thead>
              <tbody>{PIPELINE_STAGES.map((s) => { const l = open.filter((o) => o.stage === s); return <tr key={s} className="border-b border-border/60 last:border-0"><th scope="row" className="px-4 py-2 text-left font-normal">{stageLabel(s)}</th><td className="px-3 py-2 text-right tabular-nums">{l.length}</td><ValueCells list={l} currencies={currencies} /></tr>; })}</tbody>
            </table></div>
            <div className="px-4 pb-3"><SampleNote n={open.length} what="open opportunities" /></div>
          </Panel>

          <Panel title="Open pipeline by owner" flush>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Open pipeline by owner table"><table className="w-full text-sm"><caption className="sr-only">Open pipeline by owner</caption>
              <thead><tr className="border-b border-border text-xs text-muted-foreground"><th scope="col" className="px-4 py-2 text-left font-medium">Owner</th><th scope="col" className={th}>Open</th>{currencies.map((c) => <th key={c} scope="col" className={th}>{c}</th>)}</tr></thead>
              <tbody>{SALES_USERS.map((p) => { const l = open.filter((o) => o.owner === p); return <tr key={p} className="border-b border-border/60 last:border-0"><th scope="row" className="px-4 py-2 text-left font-normal">{personName(p)}</th><td className="px-3 py-2 text-right tabular-nums">{l.length}</td><ValueCells list={l} currencies={currencies} /></tr>; })}</tbody>
            </table></div>
            <div className="px-4 pb-3"><SampleNote n={open.length} what="open opportunities" /></div>
          </Panel>

          <Panel title="Follow-ups due and overdue">
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[{ l: "Overdue", n: fus.filter((f) => !f.doneAt && f.due < "2026-10-19").length }, { l: "Due today", n: fus.filter((f) => !f.doneAt && f.due === "2026-10-19").length }, { l: "Upcoming", n: fus.filter((f) => !f.doneAt && f.due > "2026-10-19").length }].map((x) => <div key={x.l} className="rounded-md border border-border p-3"><dt className="text-xs text-muted-foreground">{x.l}</dt><dd className="font-heading text-2xl font-semibold">{x.n}</dd></div>)}
            </dl>
            <SampleNote n={fus.length} what="follow-ups" />
          </Panel>

          <Panel title="Timeliness">
            <dl className="space-y-3 text-sm">
              <div><dt className="font-medium">First response</dt><dd className="text-muted-foreground">{median === null ? "No responses recorded in this scope." : `Median ${median.toFixed(1)} hours from logging to first response (${responded.length} of ${all.length} responded).`}</dd><dd className="text-xs text-muted-foreground">Share within target: <strong>not available</strong>, because no response target is configured yet.</dd></div>
              <div><dt className="font-medium">Follow-up completion</dt><dd className="text-muted-foreground">{completed.length ? `${onTime} of ${completed.length} completed follow-ups were finished on or before their due date.` : "No completed follow-ups in this scope."}</dd><dd className="text-xs text-muted-foreground">Very small sample: read with care.</dd></div>
            </dl>
            <SampleNote n={all.length} what="opportunities" />
          </Panel>

          <Panel title="Won and lost">
            <div className="grid grid-cols-2 gap-3 text-center"><div className="rounded-md border border-border p-3"><div className="text-xs text-muted-foreground">Won</div><div className="font-heading text-2xl font-semibold">{won.length}</div></div><div className="rounded-md border border-border p-3"><div className="text-xs text-muted-foreground">Lost</div><div className="font-heading text-2xl font-semibold">{lost.length}</div></div></div>
            <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lost reasons</h3>
            {reasons.length ? <ul className="space-y-1 text-sm">{reasons.map((x) => <li key={x.r} className="flex justify-between"><span>{x.r}</span><span className="tabular-nums">{x.n}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No lost opportunities in this scope.</p>}
            <SampleNote n={won.length + lost.length} what="closed opportunities" />
          </Panel>

          <Panel title="Won value, invoiced and collected" description="Three different things. Invoicing and payments are recorded in Zoho Books; here we only hold references and dates." className="lg:col-span-2" flush>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Won value against invoice and payment table"><table className="w-full min-w-[34rem] text-sm"><caption className="sr-only">Won value against invoice and payment status</caption>
              <thead><tr className="border-b border-border text-xs text-muted-foreground">{["Opportunity", "Won value", "Invoice issued", "Payment received"].map((h, i) => <th key={h} scope="col" className={i ? "px-3 py-2 text-left font-medium" : "px-4 py-2 text-left font-medium"}>{h}</th>)}</tr></thead>
              <tbody>
                {won.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No won opportunities in this scope.</td></tr> : won.map((o) => { const z = ZOHO.find((x) => x.oppId === o.id); return (
                  <tr key={o.id} className="border-b border-border/60 last:border-0"><th scope="row" className="px-4 py-2 text-left font-normal">{o.ref} · {o.title}</th><td className="px-3 py-2 tabular-nums">{o.currency} {fmt(o.value ?? 0)}</td><td className="px-3 py-2">{z?.invoiceRef ? `${z.invoiceRef}, ${fmtDate(z.invoiceIssuedOn)}` : "Not recorded"}</td><td className="px-3 py-2">{z?.paymentReceivedOn ? fmtDate(z.paymentReceivedOn) : "Not recorded"}</td></tr>
                ); })}
              </tbody>
            </table></div>
            <div className="px-4 pb-3"><SampleNote n={won.length} what="won opportunities" /></div>
          </Panel>
        </div>
      </StateGate>
    </>
  );
}
