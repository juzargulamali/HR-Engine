"use client";

import { useRef, useState } from "react";
import { nextAction, varianceLabel, RECEIPT_LABELS, type BudgetFlowState, type VersionStatus } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { OsBadge } from "@/components/os/pills";
import { cn } from "@/lib/utils";
import type { PbxBudgetView } from "@/types/budget";
import { ActualsSection, type ClaimOption } from "./actuals-section";
import { BudgetSection } from "./budget-section";
import { FundsSection } from "./funds-section";
import { RatesPanel } from "./rates-panel";
import { SettlementSection } from "./settlement-section";
import { Figure, day, money } from "./shared";

export type BudgetTab = "budget" | "funds" | "actuals" | "settlement";
const LABELS: Record<BudgetTab, string> = { budget: "Budget", funds: "Funds", actuals: "Actual expenses", settlement: "Settlement" };

function flowState(view: PbxBudgetView): BudgetFlowState {
  const versions = view.versions;
  const latest = [...versions].sort((a, b) => b.seq - a.seq)[0];
  const actual = [...view.actuals].sort((a, b) => b.seq - a.seq)[0];
  return {
    hasBudget: !!view.budget,
    latestBudget: (latest?.status as VersionStatus | undefined) ?? null,
    latestBudgetKind: latest?.kind ?? null,
    hasApprovedBaseline: view.baseline > 0 || versions.some((v) => v.kind === "original" && v.status === "approved"),
    approvalOnHold: (latest?.status === "submitted" && latest.on_hold) || (actual?.status === "submitted" && actual.on_hold) || false,
    actuals: (actual?.status as VersionStatus | undefined) ?? null,
    approvedActuals: view.actuals.some((a) => a.status === "approved"),
    fundingRecorded: view.funding.some((f) => f.status === "recorded"),
    receipts: view.budget?.receipts_status ?? "not_received",
    settlementClosed: view.budget?.settlement_status === "closed",
    blockers: view.settlement?.blockers ?? [],
  };
}

function Summary({ view }: { view: PbxBudgetView }) {
  const b = view.budget!;
  const cur = b.currency;
  const s = view.settlement;
  // Only submitted or approved final expenses are compared with the budget: a draft is unfinished and would read as "far under budget".
  const approved = view.actuals.find((a) => a.status === "approved");
  const shown = approved ?? [...view.actuals].sort((a, c) => c.seq - a.seq).find((a) => a.status === "submitted");
  const base = view.baseline;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Summary">
      <Figure label="Approved budget" value={base > 0 ? money(base, cur) : "Not approved yet"} />
      <Figure
        label={approved ? "Approved final expenses" : shown ? "Final expenses (waiting for Finance)" : "Final expenses"}
        value={shown ? money(shown.total_actual, cur) : "Not submitted"}
      />
      <Figure
        label="Over / under budget"
        value={shown && base > 0 ? varianceLabel(shown.total_actual, base, cur) : "—"}
        tone={shown && base > 0 ? (shown.total_actual > base ? "over" : shown.total_actual < base ? "under" : null) : null}
      />
      {s ? (
        s.has_approved_actuals ? (
          <Figure label="Still to settle" value={money(s.advance_to_return + s.reimbursement_outstanding, cur)} hint={`To return ${money(s.advance_to_return, cur)} · owed ${money(s.reimbursement_outstanding, cur)}`} />
        ) : (
          <Figure label="Still to settle" value="—" hint="Known once Finance approves the final expenses" />
        )
      ) : (
        <Figure label="Receipts" value={RECEIPT_LABELS[b.receipts_status]} />
      )}
    </div>
  );
}

function ProjectFacts({ view }: { view: PbxBudgetView }) {
  const p = view.project;
  const facts: [string, string][] = [
    ["Reference", p.reference],
    ["Company", p.company_name ?? "—"],
    ["Project Manager", p.pm_name ?? "—"],
    ["Site", p.location ?? "—"],
    ["Installation", day(p.install_start)],
    ["Event", p.event_start ? `${day(p.event_start)}${p.event_end && p.event_end !== p.event_start ? ` – ${day(p.event_end)}` : ""}` : "—"],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {facts.map(([k, v]) => <div key={k} className="min-w-0"><dt className="inline text-muted-foreground">{k}: </dt><dd className="inline break-words">{v}</dd></div>)}
    </dl>
  );
}

/**
 * One budget, four sections: Budget / Funds / Actual expenses / Settlement. The same component is shown inside the project (for the Project Manager) and in
 * the Finance area, so both work on the same records: there is no second approval form anywhere. What each person can do is decided by the database; the
 * page only hides what it already knows is not theirs.
 */
export function BudgetWorkspace({ view, claims, initialTab, projectHeader = false }: { view: PbxBudgetView; claims: ClaimOption[]; initialTab?: BudgetTab; projectHeader?: boolean }) {
  const hasBudget = !!view.budget;
  const full = view.viewer.is_full_reader;
  const tabs: BudgetTab[] = hasBudget ? (full ? ["budget", "funds", "actuals", "settlement"] : ["budget", "actuals"]) : ["budget"];
  const state = hasBudget ? flowState(view) : null;
  const next = state ? nextAction(state) : null;
  const [tab, setTab] = useState<BudgetTab>(initialTab && tabs.includes(initialTab) ? initialTab : next && tabs.includes(next.section) ? next.section : "budget");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const choose = (t: BudgetTab) => {
    setTab(t);
    try { window.history.replaceState(null, "", `?section=${t}`); } catch { /* the address is only a convenience */ }
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = tabs[(i + d + tabs.length) % tabs.length]!;
    choose(n);
    refs.current[n]?.focus();
  };

  return (
    <div className="space-y-4">
      {projectHeader ? (
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{view.project.name}</h1>
          <ProjectFacts view={view} />
        </div>
      ) : null}
      {view.budget ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <OsBadge tone="neutral">Expenses in {view.budget.currency}</OsBadge>
          <OsBadge tone={view.budget.settlement_status === "closed" ? "green" : "blue"} dot>{view.budget.settlement_status === "closed" ? "Settlement closed" : "Settlement open"}</OsBadge>
          {view.project.status === "completed" || view.project.status === "archived" ? <OsBadge tone="quiet">Project {view.project.status}: settlement continues separately</OsBadge> : null}
        </div>
      ) : null}
      {hasBudget ? <Summary view={view} /> : null}
      {next ? (
        <Alert role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Next:</span>
          <span>{next.text}</span>
          {next.section !== tab && tabs.includes(next.section) ? <button type="button" className="font-medium underline underline-offset-2" onClick={() => choose(next.section)}>Go to {LABELS[next.section]}</button> : null}
        </Alert>
      ) : null}

      <div role="tablist" aria-label="Budget and expenses sections" className="grid border-b border-border sm:flex sm:gap-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t, i) => (
          <button
            key={t}
            ref={(el) => { refs.current[t] = el; }}
            id={`pbx-tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`pbx-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => choose(t)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn("-mb-px min-h-12 border-b-2 px-1 text-center text-[13px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-11 sm:whitespace-nowrap sm:px-4 sm:text-[0.9375rem]", tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {LABELS[t]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`pbx-panel-${tab}`} aria-labelledby={`pbx-tab-${tab}`} tabIndex={0} className="focus-visible:outline-none">
        {tab === "budget" ? (
          <div className="space-y-4">
            <BudgetSection view={view} />
            {hasBudget ? <RatesPanel view={view} /> : null}
          </div>
        ) : null}
        {tab === "funds" && hasBudget ? <FundsSection view={view} /> : null}
        {tab === "actuals" && hasBudget ? <ActualsSection view={view} claims={claims} /> : null}
        {tab === "settlement" && hasBudget ? <SettlementSection view={view} /> : null}
      </div>
    </div>
  );
}
