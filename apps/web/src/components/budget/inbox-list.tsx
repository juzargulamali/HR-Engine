"use client";

import Link from "next/link";
import { useState } from "react";
import { RECEIPT_LABELS, varianceLabel, type ApprovalRoute } from "@enginious-hr/domain";
import { OsBadge } from "@/components/os/pills";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableBody, TableCell, TableHead, TableHeader } from "@/components/ui/table";
import { ClickableRow } from "@/components/workspace/clickable-row";
import type { PbxInbox, PbxInboxActuals, PbxInboxBase, PbxInboxBudget, PbxInboxSettlement } from "@/types/budget";
import { money, stamp } from "./shared";

type Filter = "all" | "budget" | "actuals" | "settlement";

const num = (v: string | number | null) => (v === null || v === "" ? 0 : Number(v));

function Project({ r, section }: { r: PbxInboxBase; section: string }) {
  return (
    <TableCell className="font-medium">
      <Link href={`/finance/project-budgets/${r.project_id}?section=${section}`} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{r.name}</Link>
      <span className="block text-[13px] font-normal text-muted-foreground">{r.reference} · {r.company_name}</span>
    </TableCell>
  );
}

function Decision({ canDecide, onHold, route }: { canDecide: boolean; onHold: boolean; route: ApprovalRoute }) {
  if (onHold) return <OsBadge tone="amber" dot>On hold: no eligible approver</OsBadge>;
  if (canDecide) return <OsBadge tone="blue" dot>Ready for you to decide</OsBadge>;
  return <OsBadge tone="neutral" dot>{route === "executive" ? "Waiting for the CEO or CTO" : "Waiting for Finance"}</OsBadge>;
}

function BudgetTable({ rows }: { rows: PbxInboxBudget[] }) {
  return (
    <Table stack>
      <TableHeader><tr><TableHead>Project</TableHead><TableHead>Project Manager</TableHead><TableHead>Request</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Submitted</TableHead><TableHead>Status</TableHead></tr></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <ClickableRow key={r.version_id} href={`/finance/project-budgets/${r.project_id}?section=budget`}>
            <Project r={r} section="budget" />
            <TableCell>{r.pm_name ?? "—"}</TableCell>
            <TableCell>{r.kind === "addition" ? "Additional budget" : "Budget"}</TableCell>
            <TableCell className="text-right tabular-nums">{money(r.total, r.currency)}</TableCell>
            <TableCell className="text-[13px]">{stamp(r.submitted_at, r.site_timezone)}<span className="block text-muted-foreground">by {r.submitted_by_name ?? "—"}</span></TableCell>
            <TableCell><Decision canDecide={r.i_can_decide} onHold={r.on_hold} route={r.approval_route} /></TableCell>
          </ClickableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ActualsTable({ rows }: { rows: PbxInboxActuals[] }) {
  return (
    <Table stack>
      <TableHeader><tr><TableHead>Project</TableHead><TableHead>Project Manager</TableHead><TableHead className="text-right">Approved budget</TableHead><TableHead className="text-right">Actual</TableHead><TableHead>Difference</TableHead><TableHead>Submitted</TableHead><TableHead>Status</TableHead></tr></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <ClickableRow key={r.submission_id} href={`/finance/project-budgets/${r.project_id}?section=actuals`}>
            <Project r={r} section="actuals" />
            <TableCell>{r.pm_name ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{money(r.total_approved_budget, r.currency)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(r.total_actual, r.currency)}</TableCell>
            <TableCell className="text-[13px]">{varianceLabel(r.total_actual, r.total_approved_budget, r.currency)}</TableCell>
            <TableCell className="text-[13px]">{stamp(r.submitted_at, r.site_timezone)}<span className="block text-muted-foreground">by {r.submitted_by_name ?? "—"}</span></TableCell>
            <TableCell><Decision canDecide={r.i_can_decide} onHold={r.on_hold} route={r.approval_route} /></TableCell>
          </ClickableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SettlementTable({ rows }: { rows: PbxInboxSettlement[] }) {
  return (
    <Table stack>
      <TableHeader><tr><TableHead>Project</TableHead><TableHead>Project Manager</TableHead><TableHead className="text-right">Final expenses</TableHead><TableHead className="text-right">Advance to return</TableHead><TableHead className="text-right">Reimbursement owed</TableHead><TableHead>Receipts</TableHead><TableHead>Next step</TableHead></tr></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <ClickableRow key={r.budget_id} href={`/finance/project-budgets/${r.project_id}?section=settlement`}>
            <Project r={r} section="settlement" />
            <TableCell>{r.pm_name ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{r.has_approved_actuals ? money(num(r.approved_actual_total), r.currency) : "Not approved"}</TableCell>
            <TableCell className="text-right tabular-nums">{money(num(r.advance_to_return), r.currency)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(num(r.reimbursement_outstanding), r.currency)}</TableCell>
            <TableCell>{RECEIPT_LABELS[r.receipts_status]}</TableCell>
            <TableCell className="text-[13px]">{r.next}</TableCell>
          </ClickableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The Finance inbox: budget approvals, final expense approvals and outstanding settlement across the companies the person is authorised for. Every row opens the same project record. */
export function InboxList({ inbox, initialFilter }: { inbox: PbxInbox; initialFilter?: Filter }) {
  const [filter, setFilter] = useState<Filter>(initialFilter ?? "all");
  const [company, setCompany] = useState<string>("all");
  const pick = <T extends { company_id: string }>(rows: T[]) => (company === "all" ? rows : rows.filter((r) => r.company_id === company));
  const budgets = pick(inbox.budget_approvals);
  const actuals = pick(inbox.final_expense_approvals);
  const settle = pick(inbox.outstanding_settlement);
  const change = (f: Filter) => { setFilter(f); try { window.history.replaceState(null, "", f === "all" ? "?" : `?filter=${f}`); } catch { /* convenience only */ } };

  const sections = [
    { id: "budget" as const, title: "Budget approvals", count: budgets.length, body: <BudgetTable rows={budgets} />, empty: "No budgets are waiting for approval." },
    { id: "actuals" as const, title: "Final expense approvals", count: actuals.length, body: <ActualsTable rows={actuals} />, empty: "No final expenses are waiting for approval." },
    { id: "settlement" as const, title: "Outstanding settlement", count: settle.length, body: <SettlementTable rows={settle} />, empty: "Nothing is waiting to be settled." },
  ];
  const shown = filter === "all" ? sections : sections.filter((s) => s.id === filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Filter the Finance inbox"
          value={filter}
          onChange={change}
          options={[
            { value: "all", label: `All (${budgets.length + actuals.length + settle.length})` },
            { value: "budget", label: `Budget approvals (${budgets.length})` },
            { value: "actuals", label: `Final expenses (${actuals.length})` },
            { value: "settlement", label: `Outstanding settlement (${settle.length})` },
          ]}
          className="max-w-full overflow-x-auto"
        />
        {inbox.companies.length > 1 ? (
          <Select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)} className="w-auto min-w-[12rem]">
            <option value="all">All my companies</option>
            {inbox.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        ) : null}
      </div>
      {shown.map((s) => (
        <section key={s.id} aria-labelledby={`inbox-${s.id}`} className="space-y-2">
          <h2 id={`inbox-${s.id}`} className="text-sm font-semibold">{s.title} <span className="font-normal text-muted-foreground">({s.count})</span></h2>
          {s.count === 0 ? <EmptyState dense title={s.empty} description="When something needs you it will appear here." /> : s.body}
        </section>
      ))}
    </div>
  );
}
