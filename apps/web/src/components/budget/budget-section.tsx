"use client";

import { useState } from "react";
import { ACTIVITY_LABELS, RATE_LABELS_BY_KEY, moneyText, sumMoney, type RateKey } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel, Muted } from "@/components/projects/parts";
import { createBudget, decideBudget, requestAddition, reviseBudget } from "@/lib/actions/projectBudget";
import type { PbxBudgetRow, PbxBudgetView, PbxVersion } from "@/types/budget";
import { BudgetEditor } from "./budget-editor";
import { ActionMessage, Field, HoldAlert, RouteLine, StatusPill, day, money, stamp, useAction } from "./shared";

const versionName = (v: PbxVersion, versions: PbxVersion[]) => {
  if (v.kind === "original") return `Original budget${versions.filter((x) => x.kind === "original").length > 1 ? ` (version ${v.seq})` : ""}`;
  return `Addition ${versions.filter((x) => x.kind === "addition" && x.seq <= v.seq).length}`;
};

/** Read-only lines of one version, grouped by category with their subtotals. Used for everything that is no longer a draft. */
export function RowsTable({ rows, currency }: { rows: PbxBudgetRow[]; currency: string }) {
  const cats = [...new Set(rows.map((r) => r.category_label))];
  if (rows.length === 0) return <Muted>This version has no lines.</Muted>;
  return (
    <div className="space-y-3">
      {cats.map((c) => {
        const mine = rows.filter((r) => r.category_label === c);
        return (
          <div key={c}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold">{c}</h4>
              <span className="text-sm tabular-nums text-muted-foreground">Subtotal {money(sumMoney(mine.map((r) => r.total), currency), currency)}</span>
            </div>
            <Table stack>
              <TableHeader>
                <TableRow><TableHead>Description</TableHead><TableHead>When</TableHead><TableHead>Calculation</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {mine.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.description}
                      <span className="block text-[13px] font-normal text-muted-foreground">{ACTIVITY_LABELS[r.activity]}</span>
                    </TableCell>
                    <TableCell>{r.date_from ? (r.date_to && r.date_to !== r.date_from ? `${day(r.date_from)} – ${day(r.date_to)}` : day(r.date_from)) : "—"}</TableCell>
                    <TableCell>{calcText(r, currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.total, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}

/** "3 people × 2 days × AED 60.00" in words, from the stored inputs of the line. */
function calcText(r: PbxBudgetRow, currency: string): string {
  const n = (v: number | null) => (v === null ? "?" : String(v));
  const rate = r.rate === null ? "?" : moneyText(r.rate, currency);
  let text: string;
  switch (r.basis) {
    case "fixed": text = "Fixed total for the whole period"; break;
    case "per_person": text = `${n(r.people)} people × ${rate}`; break;
    case "per_person_day": text = `${n(r.people)} people × ${n(r.days)} days × ${rate}`; break;
    case "per_trip": text = `${n(r.qty)} trips × ${rate}`; break;
    case "per_km": text = `${n(r.qty)} km × ${rate}`; break;
    default: text = `${n(r.qty)} × ${rate}`;
  }
  if (r.rate_key && r.configured_rate !== null && r.rate !== null && r.rate !== r.configured_rate) {
    text += ` (company rate ${RATE_LABELS_BY_KEY[r.rate_key as RateKey]?.toLowerCase() ?? ""} is ${moneyText(r.configured_rate, currency)})`;
  }
  return text;
}

function CreateBudget({ view }: { view: PbxBudgetView }) {
  const a = useAction();
  const [currency, setCurrency] = useState(view.default_currency ?? "AED");
  return (
    <Panel title="Create the project budget" description="One budget per project, in one currency. Nothing is converted between currencies.">
      <form className="max-w-xl space-y-3" onSubmit={(e) => { e.preventDefault(); a.run(() => createBudget({ projectId: view.project.id, currency })); }}>
        <Field label="Expense currency" htmlFor="pbx-cur" hint="The currency the expenses will be paid in. It cannot be changed once the budget exists. If something is paid in another currency, record it in that line's note with the original amount and rate.">
          <input id="pbx-cur" className="flex h-9 w-32 rounded-md border border-input bg-field px-3 py-1 text-sm uppercase shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
        <Button type="submit" disabled={a.pending || currency.length !== 3}>{a.pending ? "Creating…" : "Create budget"}</Button>
        <ActionMessage error={a.error} />
      </form>
    </Panel>
  );
}

function ApproverDecision({ view, version }: { view: PbxBudgetView; version: PbxVersion }) {
  const a = useAction();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<"return" | "reject" | null>(null);
  const decide = (decision: "approve" | "return" | "reject") => a.run(() => decideBudget({ projectId: view.project.id, versionId: version.id, decision, note }), () => { setAsking(null); setNote(""); });
  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
      <p className="text-sm font-medium">{version.kind === "addition" ? "Decide this additional budget request" : "Decide this budget"} — total {money(version.total, view.budget!.currency)}{version.approval_route === "executive" ? " (as the CEO or CTO approver)" : ""}</p>
      {asking ? (
        <div className="space-y-2">
          <Field label={asking === "return" ? "What should the Project Manager change?" : "Why is it rejected?"} htmlFor="pbx-note-d"><Textarea id="pbx-note-d" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={asking === "reject" ? "destructive" : "default"} disabled={a.pending || note.trim() === ""} onClick={() => decide(asking)}>{asking === "return" ? "Return to the Project Manager" : "Reject"}</Button>
            <Button type="button" variant="ghost" disabled={a.pending} onClick={() => setAsking(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={a.pending} onClick={() => decide("approve")}>{a.pending ? "Saving…" : "Approve"}</Button>
          <Button type="button" variant="outline" disabled={a.pending} onClick={() => setAsking("return")}>Return for changes</Button>
          <Button type="button" variant="outline" disabled={a.pending} onClick={() => setAsking("reject")}>Reject</Button>
        </div>
      )}
      <p className="text-[13px] text-muted-foreground">One decision is final for this version. Nobody can approve their own submission.</p>
      <ActionMessage error={a.error} />
    </div>
  );
}

function VersionCard({ view, version, versions, defaultOpen }: { view: PbxBudgetView; version: PbxVersion; versions: PbxVersion[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const tz = view.project.site_timezone;
  const currency = view.budget!.currency;
  const a = useAction();
  const mine = view.viewer.is_pm;
  const canRevise = mine && (version.status === "returned" || version.status === "rejected") && !versions.some((x) => x.status === "draft" || x.status === "submitted") && (version.kind === "addition" || !versions.some((x) => x.kind === "original" && x.status === "approved"));
  return (
    <div className="rounded-lg border border-border">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{versionName(version, versions)}</span>
          <StatusPill status={version.status} />
        </span>
        <span className="text-sm tabular-nums">{money(version.total, currency)}</span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border p-3">
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {version.period_start || version.period_end ? <div><dt className="inline text-muted-foreground">Expense period: </dt><dd className="inline">{day(version.period_start)} – {day(version.period_end)}</dd></div> : null}
            {version.people.length > 0 ? <div><dt className="inline text-muted-foreground">People: </dt><dd className="inline">{version.people.map((p) => p.name).join(", ")}</dd></div> : null}
            {version.submitted_at ? <div><dt className="inline text-muted-foreground">Submitted: </dt><dd className="inline">{stamp(version.submitted_at, tz)} by {version.submitted_by_name ?? "—"}</dd></div> : null}
            {version.decided_at ? <div><dt className="inline text-muted-foreground">Decided: </dt><dd className="inline">{stamp(version.decided_at, tz)} by {version.decided_by_name ?? "Finance"}</dd></div> : null}
          </dl>
          {version.note ? <p className="text-sm"><span className="text-muted-foreground">Note: </span>{version.note}</p> : null}
          {version.decision_note ? <Alert role="status" className="text-sm"><strong>{version.decided_by_name ?? "The approver"} said:</strong> {version.decision_note}</Alert> : null}
          <RowsTable rows={version.rows} currency={currency} />
          {version.status !== "draft" ? <RouteLine route={version.approval_route} /> : null}
          {version.status === "submitted" && version.on_hold ? <HoldAlert route={version.approval_route} submitterName={version.submitted_by_name} /> : null}
          {version.status === "submitted" && version.i_can_decide ? <ApproverDecision view={view} version={version} /> : null}
          {version.status === "submitted" && !version.i_can_decide && !version.on_hold && (view.viewer.user_id === version.created_by || view.viewer.user_id === version.submitted_by) && (view.viewer.is_finance || view.viewer.is_executive) ? (
            <Muted>You prepared or submitted this, so someone else decides it.</Muted>
          ) : null}
          {canRevise ? (
            <div className="space-y-1">
              <Button type="button" disabled={a.pending} onClick={() => a.run(() => reviseBudget({ projectId: view.project.id, versionId: version.id }))}>{a.pending ? "Preparing…" : "Make a new draft from this version"}</Button>
              <p className="text-[13px] text-muted-foreground">This version stays on record exactly as it was; the draft is a copy you can change.</p>
              <ActionMessage error={a.error} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The Budget section: summary of what is approved, the draft being prepared (PM), the decision (the routed approver), and every version as history. */
export function BudgetSection({ view }: { view: PbxBudgetView }) {
  const add = useAction();
  if (!view.budget) {
    return view.viewer.is_pm ? <CreateBudget view={view} /> : <Muted>No budget has been prepared for this project yet.</Muted>;
  }
  const currency = view.budget.currency;
  const versions = view.versions;
  const draft = versions.find((v) => v.status === "draft");
  const open = versions.find((v) => v.status === "submitted");
  const approvedOriginal = versions.find((v) => v.kind === "original" && v.status === "approved");
  const additions = versions.filter((v) => v.kind === "addition" && v.status === "approved");
  const additionsTotal = sumMoney(additions.map((v) => v.total), currency);
  const canAdd = view.viewer.is_pm && !!approvedOriginal && !draft && !open && view.budget.settlement_status === "open";
  const history = [...versions].filter((v) => v.id !== draft?.id).sort((a, b) => b.seq - a.seq);

  return (
    <div className="space-y-4">
      {approvedOriginal ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="os-card px-3.5 py-2.5"><div className="text-[13px] text-muted-foreground">Original approved budget</div><div className="mt-1 font-heading text-xl font-semibold tabular-nums">{money(approvedOriginal.total, currency)}</div></div>
          <div className="os-card px-3.5 py-2.5"><div className="text-[13px] text-muted-foreground">Approved additions</div><div className="mt-1 font-heading text-xl font-semibold tabular-nums">{money(additionsTotal, currency)}</div></div>
          <div className="os-card px-3.5 py-2.5"><div className="text-[13px] text-muted-foreground">Revised approved budget</div><div className="mt-1 font-heading text-xl font-semibold tabular-nums">{money(view.baseline, currency)}</div></div>
        </div>
      ) : null}

      {draft && view.viewer.is_pm ? (
        <Panel title={draft.kind === "addition" ? "Additional budget request (draft)" : "Draft budget"} description={draft.kind === "addition" ? "Only the extra amount is entered here. The approved budget stays as it is until the approver approves this request." : "Prepare the expenses you expect. Nothing is sent for approval until you submit."}>
          <BudgetEditor key={`${draft.id}:${draft.row_version}`} view={view} version={draft} />
        </Panel>
      ) : draft ? (
        <Muted>A draft is being prepared by the Project Manager.</Muted>
      ) : null}

      {canAdd ? (
        <div className="space-y-1">
          <Button type="button" variant="outline" disabled={add.pending} onClick={() => add.run(() => requestAddition({ projectId: view.project.id, budgetId: view.budget!.id }))}>{add.pending ? "Starting…" : "Request additional budget"}</Button>
          <p className="text-[13px] text-muted-foreground">The approved budget is never overwritten. You enter only the extra amount; The appropriate approver decides it separately.</p>
          <ActionMessage error={add.error} />
        </div>
      ) : null}

      <Panel title="Budget history" description="Every submitted version is kept exactly as it was, with the approver's decision.">
        {history.length === 0 ? <Muted>{draft ? "Nothing submitted yet." : "No versions yet."}</Muted> : (
          <div className="space-y-2">
            {history.map((v, i) => <VersionCard key={v.id} view={view} version={v} versions={versions} defaultOpen={i === 0 || v.status === "submitted"} />)}
          </div>
        )}
      </Panel>
      {!view.viewer.is_full_reader ? <Muted>You are shown what you prepared or submitted. Funds and settlement are for the current Project Manager and Finance.</Muted> : null}
    </div>
  );
}

/** Used in the workspace header: rates Finance has set for this company in the budget's currency (read-only everywhere; Finance edits them in RatesPanel). */
export function ratesSummary(view: PbxBudgetView): string {
  const cur = view.budget?.currency ?? view.default_currency ?? "AED";
  const parts = view.rates.map((r) => `${RATE_LABELS_BY_KEY[r.rate_key as RateKey] ?? r.rate_key} ${moneyText(r.amount, cur)}`);
  return parts.length ? parts.join(" · ") : "No company rates set yet";
}

