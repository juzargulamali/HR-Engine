"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ACTIVITIES, COMPANIES, OPPORTUNITIES, PIPELINE_STAGES, attention, fmtDate, fmtDateTime, isOpen, oppById, personName, relDays, stageLabel, type CompanyId, type Currency, type Opportunity,
} from "../_lib/data";
import { PLink, usePreview } from "../_components/context";
import { Chip, DueChip, OverdueBanner, PageHeader, Panel, Restriction, Stat, StateGate } from "../_components/ui";
import { ClientLine } from "../_components/sales-bits";

type Scope = "all" | CompanyId;

export default function SalesOverview() {
  const { roleDef, state } = usePreview();
  const [scope, setScope] = useState<Scope>(roleDef.crossCompany ? "all" : "uae");
  const inScope = (o: Opportunity) => scope === "all" || o.company === scope;
  const a = attention(inScope);
  const open = OPPORTUNITIES.filter((o) => isOpen(o) && inScope(o));
  const currencies = (scope === "all" ? ["AED", "SAR", "EUR"] : [COMPANIES[scope].currency]) as Currency[];

  const items: { key: string; label: string; count: number; tone: "neutral" | "bad" | "warn"; hint: string }[] = [
    { key: "first", label: "Awaiting first response", count: a.awaitingFirstResponse.length, tone: "warn", hint: "Nobody has replied yet" },
    { key: "today", label: "Follow-ups due today", count: a.dueToday.length, tone: "warn", hint: "Calls, emails, meetings" },
    { key: "overdue", label: "Overdue follow-ups", count: a.overdue.length, tone: "bad", hint: "Past the agreed date" },
    { key: "wait", label: "Waiting for client", count: a.waitingForClient.length, tone: "neutral", hint: "We have replied; ball is with them" },
    { key: "prep", label: "Proposal preparation overdue", count: a.proposalPrepOverdue.length, tone: "bad", hint: "Draft not finished by its date" },
    { key: "install", label: "Install soon, no confirmation", count: a.installNoConfirmation.length, tone: "warn", hint: "Within 21 days, availability not confirmed" },
  ];

  // One row per opportunity, with every reason it needs attention (overdue first, then due today, then the rest).
  const reasons: { opp: Opportunity; rank: number; reason: string; chip: React.ReactNode }[] = [
    ...a.overdue.map((f) => ({ opp: oppById(f.oppId), rank: 0, reason: f.title, chip: <DueChip key={f.id} due={f.due} /> })),
    ...a.dueToday.map((f) => ({ opp: oppById(f.oppId), rank: 1, reason: f.title, chip: <DueChip key={f.id} due={f.due} /> })),
    ...a.awaitingFirstResponse.map((o) => ({ opp: o, rank: 2, reason: "Enquiry logged, no first response yet", chip: <Chip key={`r${o.id}`} tone="warn">Awaiting first response</Chip> })),
    ...a.installNoConfirmation.map((o) => ({ opp: o, rank: 3, reason: `Install ${fmtDate(o.installStart)} (${relDays(o.installStart!)}), availability ${o.availability.state === "awaiting" ? "awaiting confirmation" : "unverified"}`, chip: <Chip key={`i${o.id}`} tone="warn">Install soon</Chip> })),
  ];
  const grouped = [...new Set(reasons.map((r) => r.opp.id))]
    .map((id) => ({ opp: oppById(id), items: reasons.filter((r) => r.opp.id === id).sort((x, y) => x.rank - y.rank) }))
    .sort((x, y) => x.items[0]!.rank - y.items[0]!.rank);
  const shown = state === "overdue" ? grouped.filter((g) => g.items.some((i) => i.rank === 0)) : grouped;

  const recent = ACTIVITIES.filter((x) => inScope(oppById(x.oppId))).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 5);

  return (
    <>
      <PageHeader
        eyebrow="Sales & CRM"
        title="Sales overview"
        description="What needs attention right now. Counts come from the records below; nothing is estimated."
        actions={<PLink href="/os-preview/sales/new" className={cn(buttonVariants({ size: "sm" }))}><Plus className="h-4 w-4" aria-hidden />New enquiry</PLink>}
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Company</span>
          <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className="h-9 w-56">
            <option value="all" disabled={!roleDef.crossCompany}>All companies{roleDef.crossCompany ? "" : " (not available to you)"}</option>
            {(Object.keys(COMPANIES) as CompanyId[]).map((c) => <option key={c} value={c}>{COMPANIES[c].name.replace(" (sample entity)", "")}</option>)}
          </Select>
        </label>
        {!roleDef.crossCompany ? <Restriction>Totals across companies are limited to authorised founders. You can still open any opportunity.</Restriction> : null}
      </div>

      <StateGate what="the Sales overview" emptyTitle="No opportunities yet" emptyText="When the first enquiry is recorded it will appear here, with follow-ups and anything that needs attention." emptyAction={<PLink href="/os-preview/sales/new" className={cn(buttonVariants({ size: "sm" }))}>Record the first enquiry</PLink>}>
        {state === "overdue" ? <OverdueBanner count={a.overdue.length} /> : null}
        {state !== "overdue" ? (
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {items.map((i) => <Stat key={i.key} label={i.label} value={i.count} tone={i.count === 0 ? "neutral" : i.tone} hint={i.hint} />)}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <Panel title="Needs attention now" description="Overdue first, then due today, then everything else." className="lg:col-span-2" flush>
            {shown.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing needs attention in this scope.</p> : (
              <ul className="divide-y divide-border/70">
                {shown.map((g) => (
                  <li key={g.opp.id} className="px-4 py-3">
                    <PLink href={`/os-preview/sales/opportunities/${g.opp.ref}`} className="text-sm font-medium hover:underline">{g.opp.title}</PLink>
                    <p className="text-xs text-muted-foreground"><ClientLine o={g.opp} /> · {g.opp.ref} · Owner {personName(g.opp.owner)}</p>
                    <ul className="mt-1.5 space-y-1">
                      {g.items.map((i, k) => <li key={k} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"><span>{i.reason}</span>{i.chip}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="space-y-6">
            <Panel title="Open pipeline" description={scope === "all" ? "One line per currency. Never added together." : `In ${currencies[0]} only.`}>
              <ul className="space-y-2">
                {PIPELINE_STAGES.map((s) => {
                  const inStage = open.filter((o) => o.stage === s);
                  return (
                    <li key={s} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">{stageLabel(s)}</span>
                      <span className="text-right">
                        <span className="font-medium tabular-nums">{inStage.length}</span>
                        <span className="block text-[11px] text-muted-foreground">{currencies.map((c) => `${c} ${inStage.filter((o) => o.currency === c).reduce((n, o) => n + (o.value ?? 0), 0).toLocaleString("en-US")}`).join(" · ")}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <PLink href="/os-preview/sales/pipeline" className="mt-3 inline-block text-sm font-medium text-[hsl(var(--os-link))] hover:underline">Open pipeline board</PLink>
            </Panel>
            <Panel title="Recent activity" flush>
              <ul className="divide-y divide-border/70">
                {recent.map((x) => (
                  <li key={x.id} className="px-4 py-2.5 text-sm">
                    <p>{x.text}</p>
                    <p className="text-xs text-muted-foreground">{personName(x.by)} · {fmtDateTime(x.at)} · {x.internal ? "Internal note" : x.type === "client_response" ? "Client response" : "Recorded activity"}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </StateGate>
    </>
  );
}
