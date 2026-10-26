"use client";

import { useState } from "react";
import { PAYMENT_KINDS, PAYMENT_KIND_LABELS, RECEIPT_LABELS, RECEIPT_STATUSES, varianceLabel, type PaymentKind, type ReceiptStatus } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OsBadge } from "@/components/os/pills";
import { Panel, Muted } from "@/components/projects/parts";
import { closeSettlement, recordPayment, recordReceipts, reopenSettlement, reversePayment } from "@/lib/actions/projectBudget";
import type { PbxBudgetView, PbxPayment } from "@/types/budget";
import { ActionMessage, Field, Figure, cleanDecimal, day, money, stamp, useAction } from "./shared";
import { todayIn } from "./funds-section";

function Receipts({ view }: { view: PbxBudgetView }) {
  const b = view.budget!;
  const a = useAction();
  const [status, setStatus] = useState<ReceiptStatus>(b.receipts_status);
  const [date, setDate] = useState(b.receipts_received_on ?? todayIn(view.project.site_timezone));
  const [reason, setReason] = useState(b.receipts_exception_reason ?? "");
  const canEdit = view.viewer.is_finance && b.settlement_status === "open";
  const tone = b.receipts_status === "received" ? "green" : b.receipts_status === "exception" ? "amber" : "neutral";
  return (
    <Panel title="Physical receipts" description="Receipts are handed to Finance outside this application. Finance records here whether they arrived. Nothing is uploaded.">
      <div className="space-y-3">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <OsBadge tone={tone} dot>{RECEIPT_LABELS[b.receipts_status]}</OsBadge>
          {b.receipts_recorded_at ? <span className="text-muted-foreground">Recorded {stamp(b.receipts_recorded_at, view.project.site_timezone)} by {b.receipts_recorded_by_name ?? "Finance"}{b.receipts_received_on ? ` · received ${day(b.receipts_received_on)}` : ""}</span> : null}
        </p>
        {b.receipts_exception_reason ? <p className="text-sm"><span className="text-muted-foreground">Exception reason: </span>{b.receipts_exception_reason}</p> : null}
        {canEdit ? (
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); a.run(() => recordReceipts({ projectId: view.project.id, budgetId: b.id, status, receivedOn: status === "received" || status === "partial" ? date : null, exceptionReason: status === "exception" ? reason : null }), undefined, "Receipt status saved."); }}>
            <Field label="Receipt status" htmlFor="pbx-rs">
              <Select id="pbx-rs" value={status} onChange={(e) => setStatus(e.target.value as ReceiptStatus)}>
                {RECEIPT_STATUSES.map((s) => <option key={s} value={s}>{RECEIPT_LABELS[s]}</option>)}
              </Select>
            </Field>
            {status === "received" || status === "partial" ? <Field label="Date received" htmlFor="pbx-rd"><Input id="pbx-rd" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field> : null}
            {status === "exception" ? <Field label="Reason for the exception" htmlFor="pbx-rr" className="sm:col-span-2"><Input id="pbx-rr" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></Field> : null}
            <div className="flex items-end"><Button type="submit" disabled={a.pending || (status === "exception" && reason.trim() === "")}>{a.pending ? "Saving…" : "Save receipt status"}</Button></div>
            <div className="sm:col-span-2 lg:col-span-4"><ActionMessage error={a.error} notice={a.notice} /></div>
          </form>
        ) : null}
      </div>
    </Panel>
  );
}

function ReversePayment({ view, p }: { view: PbxBudgetView; p: PbxPayment }) {
  const a = useAction();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  if (!asking) return <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(true)}>Reverse</Button>;
  return (
    <div className="flex min-w-[14rem] flex-col gap-1.5">
      <Input aria-label="Reason for reversing this payment" placeholder="Why is it reversed?" value={reason} maxLength={1000} autoFocus onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="destructive" disabled={a.pending || reason.trim() === ""} onClick={() => a.run(() => reversePayment({ projectId: view.project.id, paymentId: p.id, reason }), () => setAsking(false))}>Reverse entry</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
      </div>
      <ActionMessage error={a.error} />
    </div>
  );
}

function RecordPayment({ view }: { view: PbxBudgetView }) {
  const s = view.settlement!;
  const currency = view.budget!.currency;
  const a = useAction();
  const [kind, setKind] = useState<PaymentKind>(s.advance_to_return > 0 ? "return" : "reimbursement");
  const candidates = s.per_person.filter((p) => (kind === "return" ? p.advance_to_return > 0 : p.reimbursement_outstanding > 0));
  const [person, setPerson] = useState("");
  const chosen = candidates.find((p) => p.user_id === person) ?? candidates[0];
  const limit = chosen ? (kind === "return" ? chosen.advance_to_return : chosen.reimbursement_outstanding) : 0;
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(() => todayIn(view.project.site_timezone));
  const [method, setMethod] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosen) return;
        a.run(() => recordPayment({ projectId: view.project.id, budgetId: view.budget!.id, kind, person: chosen.user_id, amount, paidOn, method, reference: reference || null, note: note || null, requestId: a.getRequestId() }), () => { setAmount(""); setReference(""); setNote(""); }, "Recorded.");
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="What is being recorded?" htmlFor="pbx-pk">
          <Select id="pbx-pk" value={kind} onChange={(e) => { setKind(e.target.value as PaymentKind); setPerson(""); setAmount(""); }}>
            {PAYMENT_KINDS.map((k) => <option key={k} value={k}>{PAYMENT_KIND_LABELS[k]}</option>)}
          </Select>
        </Field>
        <Field label={kind === "return" ? "Returned by" : "Paid to"} htmlFor="pbx-pp">
          <Select id="pbx-pp" value={chosen?.user_id ?? ""} onChange={(e) => setPerson(e.target.value)} disabled={candidates.length === 0}>
            {candidates.length === 0 ? <option value="">Nobody</option> : null}
            {candidates.map((p) => <option key={p.user_id} value={p.user_id}>{p.name} — {money(kind === "return" ? p.advance_to_return : p.reimbursement_outstanding, currency)} {kind === "return" ? "to return" : "owed"}</option>)}
          </Select>
        </Field>
        <Field label={`Amount (${currency})`} htmlFor="pbx-pa" hint={chosen ? `Up to ${money(limit, currency)}. Part payments are fine.` : undefined}>
          <Input id="pbx-pa" inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanDecimal(e.target.value))} required disabled={!chosen} />
        </Field>
        <Field label="Date" htmlFor="pbx-pd"><Input id="pbx-pd" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required /></Field>
        <Field label="Method" htmlFor="pbx-pm">
          <Select id="pbx-pm" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option>Bank transfer</option><option>Cash</option><option>Other</option>
          </Select>
        </Field>
        <Field label="Reference (optional)" htmlFor="pbx-pr"><Input id="pbx-pr" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Note (optional)" htmlFor="pbx-pn" className="sm:col-span-2"><Input id="pbx-pn" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <p className="text-[13px] text-muted-foreground">This only records that money moved. Nothing is paid, deducted from payroll or sent to a bank from here.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={a.pending || !chosen || !amount}>{a.pending ? "Recording…" : "Record"}</Button>
        <ActionMessage error={a.error} notice={a.notice} />
      </div>
    </form>
  );
}

function CloseControls({ view }: { view: PbxBudgetView }) {
  const b = view.budget!;
  const s = view.settlement!;
  const a = useAction();
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  if (b.settlement_status === "closed") {
    return (
      <div className="space-y-2">
        <Alert role="status" className="text-sm"><strong>Settlement is closed</strong> {stamp(b.settlement_closed_at, view.project.site_timezone)} by {b.settlement_closed_by_name ?? "Finance"}.{b.settlement_note ? ` Note: ${b.settlement_note}` : ""} Nothing can be recorded or edited until Finance reopens it, with a reason.</Alert>
        {view.viewer.is_finance ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Reason for reopening" htmlFor="pbx-ro"><Input id="pbx-ro" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button type="button" variant="outline" disabled={a.pending || reason.trim() === ""} onClick={() => a.run(() => reopenSettlement({ projectId: view.project.id, budgetId: b.id, reason }), () => setReason(""))}>Reopen settlement</Button>
          </div>
        ) : null}
        <ActionMessage error={a.error} />
      </div>
    );
  }
  const ready = s.blockers.length === 0;
  return (
    <div className="space-y-3">
      {ready ? <p className="text-sm text-[hsl(var(--os-green))]">Everything is reconciled. Settlement can be closed.</p> : (
        <div className="space-y-1">
          <p className="text-sm font-medium">Settlement cannot be closed yet:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">{s.blockers.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {view.viewer.is_finance ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Closing note (optional)" htmlFor="pbx-cn" className="min-w-[16rem] flex-1"><Input id="pbx-cn" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button type="button" disabled={a.pending || !ready} onClick={() => a.run(() => closeSettlement({ projectId: view.project.id, budgetId: b.id, note: note || null }))}>{a.pending ? "Closing…" : "Confirm reconciliation and close"}</Button>
        </div>
      ) : null}
      <ActionMessage error={a.error} />
    </div>
  );
}

/** Settlement: approved budget, approved actuals, over / under, advances, returns, reimbursements, company-paid spending, receipts, and closing. Project expense only — not profitability. */
export function SettlementSection({ view }: { view: PbxBudgetView }) {
  const budget = view.budget!;
  const currency = budget.currency;
  const s = view.settlement;
  if (!s) return <Muted>Settlement figures are for the current Project Manager and Finance.</Muted>;
  const open = budget.settlement_status === "open";
  const approvedActual = s.has_approved_actuals ? s.approved_actual_total : null;
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">These figures are the project's expenses only. They are not revenue, margin or profitability.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Approved budget" value={money(s.approved_budget, currency)} />
        <Figure label="Approved final expenses" value={approvedActual === null ? "Not approved yet" : money(approvedActual, currency)} hint={approvedActual === null ? "Settlement starts once Finance approves the final expenses." : undefined} />
        <Figure label="Over / under budget" value={approvedActual === null ? "—" : varianceLabel(approvedActual, s.approved_budget, currency)} tone={approvedActual === null ? null : approvedActual > s.approved_budget ? "over" : approvedActual < s.approved_budget ? "under" : null} />
        <Figure label="Receipts" value={RECEIPT_LABELS[budget.receipts_status]} />
        <Figure label="Advances provided" value={money(s.advances_provided, currency)} hint="Cash / bank money held by people" />
        <Figure label="Spent from advances" value={money(s.advance_spent, currency)} />
        <Figure label="Advance still to be returned" value={money(s.advance_to_return, currency)} hint={`Returned so far ${money(s.returned, currency)}`} />
        <Figure label="Reimbursement still owed" value={money(s.reimbursement_outstanding, currency)} hint={`Owed ${money(s.reimbursement_owed, currency)} · paid ${money(s.reimbursement_paid, currency)}`} />
        <Figure label="Company card and Pluto spending" value={money(s.company_card_spent, currency)} hint={`Allocated ${money(s.card_allocations, currency)} (not owed back)`} />
        <Figure label="Paid directly by the company" value={money(s.direct_paid, currency)} />
        <Figure label="Paid personally" value={money(s.personal_spent, currency)} hint="Owed back to the person" />
        <Figure label="Already in employee claims" value={money(s.existing_claim_spent, currency)} hint="Counted as project expense; paid through the claim, not here" />
      </div>

      {s.per_person.length > 0 ? (
        <Panel title="By person" description="Each person's advance and reimbursement balance is worked out separately: one person's unspent advance never covers another person's expenses.">
          <Table stack>
            <TableHeader>
              <TableRow><TableHead>Person</TableHead><TableHead className="text-right">Advance given</TableHead><TableHead className="text-right">Spent from it</TableHead><TableHead className="text-right">Returned</TableHead><TableHead className="text-right">Still to return</TableHead><TableHead className="text-right">Owed to them</TableHead><TableHead className="text-right">Paid to them</TableHead><TableHead className="text-right">Still owed</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {s.per_person.map((p) => (
                <TableRow key={p.user_id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.advance_provided, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.advance_spent, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.returned, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.advance_to_return, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.reimbursement_owed, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.reimbursement_paid, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.reimbursement_outstanding, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      ) : null}

      <Receipts view={view} />

      {view.viewer.is_finance && open && s.has_approved_actuals ? (
        <Panel title="Record money returned or a reimbursement paid" description="Partial amounts are allowed; the balance stays visible until it reaches zero.">
          <RecordPayment view={view} />
        </Panel>
      ) : null}

      <Panel title="Money returned and reimbursements">
        {view.payments.length === 0 ? <Muted>Nothing recorded yet.</Muted> : (
          <Table stack>
            <TableHeader>
              <TableRow><TableHead>What</TableHead><TableHead>Person</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Recorded</TableHead>{view.viewer.is_finance && open ? <TableHead><span className="sr-only">Actions</span></TableHead> : null}</TableRow>
            </TableHeader>
            <TableBody>
              {view.payments.map((p) => (
                <TableRow key={p.id} className={p.status === "reversed" ? "opacity-70" : undefined}>
                  <TableCell className="font-medium">{PAYMENT_KIND_LABELS[p.kind]}<span className="block text-[13px] font-normal text-muted-foreground">{[p.method, p.reference, p.note].filter(Boolean).join(" · ")}</span></TableCell>
                  <TableCell>{p.person_name}</TableCell>
                  <TableCell>{day(p.paid_on)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${p.status === "reversed" ? "line-through" : ""}`}>{money(p.amount, currency)}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {p.status === "reversed" ? <OsBadge tone="neutral">Reversed</OsBadge> : null}
                    <span className="block">By {p.recorded_by_name ?? "Finance"}, {stamp(p.recorded_at, view.project.site_timezone)}</span>
                    {p.status === "reversed" ? <span className="block">Reversed by {p.reversed_by_name ?? "Finance"}: {p.reversal_reason}</span> : null}
                  </TableCell>
                  {view.viewer.is_finance && open ? <TableCell>{p.status === "recorded" ? <ReversePayment view={view} p={p} /> : null}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel title="Close settlement" description="Closing needs approved final expenses, a reconciled advance and reimbursement balance, and Finance's confirmation about the receipts (or an approved exception with a reason).">
        <CloseControls view={view} />
      </Panel>
    </div>
  );
}
