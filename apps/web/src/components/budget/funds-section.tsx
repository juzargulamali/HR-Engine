"use client";

import { useState } from "react";
import { FUNDING_METHODS, FUNDING_METHOD_LABELS, type FundingMethod } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OsBadge } from "@/components/os/pills";
import { Panel, Muted } from "@/components/projects/parts";
import { recordFunding, reverseFunding } from "@/lib/actions/projectBudget";
import type { PbxBudgetView, PbxFunding } from "@/types/budget";
import { ActionMessage, Field, cleanDecimal, day, money, stamp, useAction } from "./shared";

/** Today's date in the project's own time zone, as YYYY-MM-DD (a date picker's value). */
export const todayIn = (tz: string | null | undefined): string => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Dubai" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
  }
};

function RecordFunding({ view }: { view: PbxBudgetView }) {
  const a = useAction();
  const tz = view.project.site_timezone;
  const [recipient, setRecipient] = useState(view.project.pm_user_id ?? view.people[0]?.id ?? "");
  const [date, setDate] = useState(() => todayIn(tz));
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<FundingMethod>("cash");
  const [otherIsAdvance, setOtherIsAdvance] = useState<"yes" | "no" | "">("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const currency = view.budget!.currency;
  const advance = method === "cash" || method === "bank_transfer" ? true : method === "pluto" ? false : otherIsAdvance === "" ? null : otherIsAdvance === "yes";
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        a.run(
          () => recordFunding({ projectId: view.project.id, budgetId: view.budget!.id, recipient, fundedOn: date, amount, method, isAdvance: method === "other" ? advance : null, reference: reference || null, note: note || null, requestId: a.getRequestId() }),
          () => { setAmount(""); setReference(""); setNote(""); },
          "Funding recorded.",
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Given to" htmlFor="pbx-fr">
          <Select id="pbx-fr" value={recipient} onChange={(e) => setRecipient(e.target.value)} required>
            {view.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.role === "pm" ? " (Project Manager)" : ""}</option>)}
          </Select>
        </Field>
        <Field label="Date" htmlFor="pbx-fd"><Input id="pbx-fd" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label={`Amount (${currency})`} htmlFor="pbx-fa"><Input id="pbx-fa" inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanDecimal(e.target.value))} required /></Field>
        <Field label="How was it provided?" htmlFor="pbx-fm">
          <Select id="pbx-fm" value={method} onChange={(e) => setMethod(e.target.value as FundingMethod)}>
            {FUNDING_METHODS.map((m) => <option key={m} value={m}>{FUNDING_METHOD_LABELS[m]}</option>)}
          </Select>
        </Field>
      </div>
      {method === "pluto" ? <p className="text-sm text-muted-foreground">A Pluto allocation or card limit is spending power, not a cash advance. It is never counted as money owed back.</p> : null}
      {method === "other" ? (
        <Field label="Is this money the person must account for and return if unspent?" htmlFor="pbx-fo" hint="Choose &ldquo;Yes&rdquo; for money handed over like a cash advance; &ldquo;No&rdquo; for a company card or similar.">
          <Select id="pbx-fo" value={otherIsAdvance} onChange={(e) => setOtherIsAdvance(e.target.value as "yes" | "no" | "")} required>
            <option value="">Choose…</option>
            <option value="yes">Yes: an advance held by the person</option>
            <option value="no">No: company card or similar</option>
          </Select>
        </Field>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reference (optional)" htmlFor="pbx-fre"><Input id="pbx-fre" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Note (optional)" htmlFor="pbx-fn"><Input id="pbx-fn" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={a.pending || !recipient || !amount}>{a.pending ? "Recording…" : "Record funding"}</Button>
        <ActionMessage error={a.error} notice={a.notice} />
      </div>
    </form>
  );
}

function Reverse({ view, entry }: { view: PbxBudgetView; entry: PbxFunding }) {
  const a = useAction();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  if (!asking) return <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(true)}>Reverse</Button>;
  return (
    <div className="flex min-w-[14rem] flex-col gap-1.5">
      <Input aria-label="Reason for reversing this entry" placeholder="Why is it reversed?" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} autoFocus />
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="destructive" disabled={a.pending || reason.trim() === ""} onClick={() => a.run(() => reverseFunding({ projectId: view.project.id, fundingId: entry.id, reason }), () => setAsking(false))}>Reverse entry</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
      </div>
      <ActionMessage error={a.error} />
    </div>
  );
}

/** Funds: what Finance has provided, kept as individual entries. Cash and bank advances held by a person are tracked apart from company card / Pluto allocations. */
export function FundsSection({ view }: { view: PbxBudgetView }) {
  const budget = view.budget!;
  const currency = budget.currency;
  const tz = view.project.site_timezone;
  const s = view.settlement;
  const canRecord = view.viewer.is_finance && !budget.settlement_status.startsWith("closed");
  const approved = view.baseline > 0;
  const entries = view.funding;
  return (
    <div className="space-y-4">
      {s ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="os-card px-3.5 py-2.5">
            <div className="text-[13px] text-muted-foreground">Cash and bank advances held by people</div>
            <div className="mt-1 font-heading text-xl font-semibold tabular-nums">{money(s.advances_provided, currency)}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">Money a person must account for and return if unspent.</div>
          </div>
          <div className="os-card px-3.5 py-2.5">
            <div className="text-[13px] text-muted-foreground">Company card and Pluto allocations</div>
            <div className="mt-1 font-heading text-xl font-semibold tabular-nums">{money(s.card_allocations, currency)}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">Spending power only. Not an advance and never owed back.</div>
          </div>
        </div>
      ) : null}

      {canRecord ? (
        <Panel title="Record funding" description="One entry per payment or allocation. These are declarations of what Finance handed over, not independent verification; an entry that involves you yourself is flagged. A recorded entry is never edited: if it was wrong, reverse it with a reason and record the correct one.">
          {approved ? <RecordFunding view={view} /> : <Alert role="status" className="text-sm">Approve the budget before recording funds.</Alert>}
        </Panel>
      ) : null}

      <Panel title="Funding entries">
        {entries.length === 0 ? (
          <Muted>No funds recorded. Many projects are paid for personally and reimbursed afterwards; that is settled on the Settlement tab.</Muted>
        ) : (
          <Table stack>
            <TableHeader>
              <TableRow><TableHead>Given to</TableHead><TableHead>Date</TableHead><TableHead>How</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Recorded</TableHead>{canRecord ? <TableHead><span className="sr-only">Actions</span></TableHead> : null}</TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((f) => (
                <TableRow key={f.id} className={f.status === "reversed" ? "opacity-70" : undefined}>
                  <TableCell className="font-medium">
                    {f.recipient_name}
                    {f.reference || f.note ? <span className="block text-[13px] font-normal text-muted-foreground">{[f.reference, f.note].filter(Boolean).join(" · ")}</span> : null}
                  </TableCell>
                  <TableCell>{day(f.funded_on)}</TableCell>
                  <TableCell>
                    {FUNDING_METHOD_LABELS[f.method]}
                    <span className="block text-[13px] text-muted-foreground">{f.is_advance ? "Advance held" : "Not an advance"}</span>
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${f.status === "reversed" ? "line-through" : ""}`}>{money(f.amount, currency)}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {f.status === "reversed" ? <OsBadge tone="neutral">Reversed</OsBadge> : null}
                    {f.self_declared ? <OsBadge tone="amber">Declared by the person it involves</OsBadge> : null}
                    <span className="block">By {f.recorded_by_name ?? "Finance"}, {stamp(f.recorded_at, tz)}</span>
                    {f.status === "reversed" ? <span className="block">Reversed by {f.reversed_by_name ?? "Finance"}: {f.reversal_reason}</span> : null}
                  </TableCell>
                  {canRecord ? <TableCell>{f.status === "recorded" ? <Reverse view={view} entry={f} /> : null}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
