"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { COMPANIES, FOLLOWUPS, OPPORTUNITIES, SALES_USERS, STAGES, nextActionOf, personName, type CompanyId, type StageId } from "../../_lib/data";
import { PLink, usePreview } from "../../_components/context";
import { Chip, DueChip, OverdueBanner, PageHeader, StageChip, StateGate } from "../../_components/ui";
import { ClientLine, CompanyText, ValueText } from "../../_components/sales-bits";

export default function OpportunityList() {
  const { state } = usePreview();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"all" | StageId>("all");
  const [owner, setOwner] = useState("all");
  const [company, setCompany] = useState<"all" | CompanyId>("all");

  const overdueIds = useMemo(() => new Set(FOLLOWUPS.filter((f) => !f.doneAt && f.due < "2026-10-19").map((f) => f.oppId)), []);
  const rows = OPPORTUNITIES.filter((o) => {
    if (state === "overdue" && !overdueIds.has(o.id)) return false;
    if (stage !== "all" && o.stage !== stage) return false;
    if (owner !== "all" && o.owner !== owner) return false;
    if (company !== "all" && o.company !== company) return false;
    const hay = `${o.ref} ${o.title} ${o.agencyId ?? ""} ${o.endClientId ?? ""} ${o.location ?? ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <>
      <PageHeader
        eyebrow="Sales & CRM"
        title="Opportunities"
        description="Every enquiry and opportunity in your authorised scope. Anyone with Sales access can see all of them."
        actions={<PLink href="/os-preview/sales/new" className={cn(buttonVariants({ size: "sm" }))}><Plus className="h-4 w-4" aria-hidden />New enquiry</PLink>}
      />
      <StateGate what="opportunities" emptyTitle="No opportunities yet" emptyText="Record an enquiry with five quick fields. Unknown dates, budget and scope are fine." emptyAction={<PLink href="/os-preview/sales/new" className={cn(buttonVariants({ size: "sm" }))}>New enquiry</PLink>}>
        {state === "overdue" ? <OverdueBanner count={rows.length} /> : null}
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem_11rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input aria-label="Search opportunities" placeholder="Search reference, title, client, place" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Filter by stage" value={stage} onChange={(e) => setStage(e.target.value as "all" | StageId)}>
            <option value="all">All stages</option>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <Select aria-label="Filter by owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">All owners</option>
            {SALES_USERS.map((p) => <option key={p} value={p}>{personName(p)}</option>)}
          </Select>
          <Select aria-label="Filter by company" value={company} onChange={(e) => setCompany(e.target.value as "all" | CompanyId)}>
            <option value="all">All companies</option>
            {(Object.keys(COMPANIES) as CompanyId[]).map((c) => <option key={c} value={c}>{COMPANIES[c].name.replace(" (sample entity)", "")}</option>)}
          </Select>
        </div>
        <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">Showing {rows.length} of {OPPORTUNITIES.length} sample opportunities</p>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No opportunities match these filters. Clear a filter or search for something else.</p>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Opportunities</caption>
                <thead className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
                  <tr>{["Opportunity", "Stage", "Owner", "Value", "Next action"].map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((o) => {
                    const next = nextActionOf(o.id);
                    return (
                      <tr key={o.id} className="border-b border-border/60 align-top last:border-0 hover:bg-secondary/30">
                        <td className="px-4 py-3">
                          <PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="font-medium hover:underline">{o.title}</PLink>
                          <div className="text-xs text-muted-foreground">{o.ref} · <ClientLine o={o} /></div>
                          <div className="text-xs text-muted-foreground"><CompanyText o={o} /></div>
                        </td>
                        <td className="px-4 py-3"><StageChip stage={o.stage} />{o.waiting === "client" && o.stage !== "on_hold" ? <div className="mt-1"><Chip>Waiting for client</Chip></div> : null}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{personName(o.owner)}</td>
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums"><ValueText o={o} /></td>
                        <td className="px-4 py-3">{next ? (<><div>{next.title}</div><div className="mt-1"><DueChip due={next.due} /></div></>) : <span className="text-muted-foreground">{o.stage === "won" ? "Closed: won" : "Closed: lost"}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 md:hidden">
              {rows.map((o) => {
                const next = nextActionOf(o.id);
                return (
                  <li key={o.id} className="rounded-lg border border-border bg-card p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="text-sm font-medium hover:underline">{o.title}</PLink>
                      <StageChip stage={o.stage} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{o.ref} · <ClientLine o={o} /></p>
                    <p className="mt-2 text-sm"><ValueText o={o} /> · {personName(o.owner)}</p>
                    {next ? <div className="mt-2 flex flex-wrap items-center gap-2 text-sm"><span>{next.title}</span><DueChip due={next.due} /></div> : null}
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
