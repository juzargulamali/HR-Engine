"use client";

import { useEffect, useState } from "react";
import { Plus, SplitSquareHorizontal, Trash2 } from "lucide-react";
import { PAID_VIA, PAID_VIA_LABELS, PAID_VIA_NEEDS_PERSON, expenseVariance, moneyText, parseDecimal, requiresVarianceNote, sumMoney, varianceLabel, type PaidVia } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel, Muted } from "@/components/projects/parts";
import { decideActuals, returnApprovedActuals, reviseActuals, saveActualsDraft, startActuals, submitActuals } from "@/lib/actions/projectBudget";
import type { PbxActualRow, PbxActuals, PbxBudgetView } from "@/types/budget";
import { ActionMessage, Field, HoldAlert, RouteLine, StatusPill, cleanDecimal, money, stamp, useAction } from "./shared";

export interface ClaimOption { id: string; label: string }

interface Line {
  key: string;
  budget_row_id: string | null;
  line_no: number;
  category_id: string;
  category_label: string;
  description: string;
  approved: number;
  actual: string;
  paid_via: PaidVia | "";
  paid_by: string;
  claim_id: string;
  foreign_currency: boolean;
  foreign_note: string;
  note: string;
  unplanned: boolean;
}

let seq = 0;
const newKey = () => `a${++seq}`;

function toLines(s: PbxActuals, categories: PbxBudgetView["categories"]): Line[] {
  return s.rows.map((r) => ({
    key: newKey(), budget_row_id: r.budget_row_id, line_no: r.line_no, category_id: categories.find((c) => c.key === r.category_key)?.id ?? "", category_label: r.category_label, description: r.description,
    approved: r.approved_amount, actual: r.actual_amount === null ? "" : String(r.actual_amount), paid_via: r.paid_via ?? "", paid_by: r.paid_by_user_id ?? "", claim_id: r.claim_id ?? "",
    foreign_currency: r.foreign_currency, foreign_note: r.foreign_note ?? "", note: r.note ?? "", unplanned: r.unplanned,
  }));
}

const amountOf = (s: string): number | null => {
  const d = parseDecimal(s);
  return d ? Number(s) : null;
};

const differenceText = (actual: number, approved: number, currency: string) => {
  const v = expenseVariance(actual, approved, currency);
  return v.kind === "on" ? "On budget" : `${v.kind === "over" ? "Over" : "Under"} ${moneyText(Math.abs(v.amount), currency)}`;
};
const differenceTone = (actual: number, approved: number, currency: string) => {
  const k = expenseVariance(actual, approved, currency).kind;
  return k === "over" ? "text-[hsl(var(--os-red))]" : k === "under" ? "text-[hsl(var(--os-green))]" : "";
};

/** Read-only comparison of an actuals submission with the approved budget: Category / Description / Approved / Actual / Difference, with totals. */
export function ActualsTable({ rows, currency, approvedTotal, actualTotal }: { rows: PbxActualRow[]; currency: string; approvedTotal: number; actualTotal: number }) {
  const groups = new Map<string, number>();
  for (const r of rows) if (r.budget_row_id && r.actual_amount !== null) groups.set(r.budget_row_id, (groups.get(r.budget_row_id) ?? 0) + r.actual_amount);
  return (
    <div className="space-y-2">
      <Table stack>
        <TableHeader>
          <TableRow><TableHead>Category</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Approved budget</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Difference</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const sum = r.budget_row_id && r.line_no === 1 ? groups.get(r.budget_row_id) : undefined;
            const diff = r.budget_row_id ? (r.line_no === 1 && sum !== undefined ? differenceText(sum, r.approved_amount, currency) : "—") : r.actual_amount === null ? "—" : differenceText(r.actual_amount, 0, currency);
            const diffTone = r.budget_row_id ? (sum !== undefined && r.line_no === 1 ? differenceTone(sum, r.approved_amount, currency) : "") : r.actual_amount === null ? "" : differenceTone(r.actual_amount, 0, currency);
            return (
              <TableRow key={r.id}>
                <TableCell>{r.category_label}</TableCell>
                <TableCell className="font-medium">
                  {r.description}
                  {r.unplanned ? <span className="ml-2 text-[13px] font-normal text-[hsl(var(--os-amber))]">Not in the budget</span> : null}
                  {r.line_no > 1 ? <span className="ml-2 text-[13px] font-normal text-muted-foreground">Part {r.line_no}</span> : null}
                  {r.actual_amount !== null && r.actual_amount > 0 ? (
                    <span className="block text-[13px] font-normal text-muted-foreground">
                      {r.paid_via ? PAID_VIA_LABELS[r.paid_via] : "How paid: not said"}{r.paid_by_name ? ` — ${r.paid_by_name}` : ""}{r.foreign_currency ? ` · Paid in another currency: ${r.foreign_note}` : ""}{r.note ? ` · ${r.note}` : ""}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.line_no === 1 ? money(r.approved_amount, currency) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.actual_amount === null ? <span className="text-muted-foreground">Not entered</span> : money(r.actual_amount, currency)}</TableCell>
                <TableCell className={`text-right tabular-nums ${diffTone}`}>{diff}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-md bg-secondary/40 px-3 py-2 text-sm">
        <span>Approved budget <strong className="tabular-nums">{money(approvedTotal, currency)}</strong></span>
        <span>Actual expenses <strong className="tabular-nums">{money(actualTotal, currency)}</strong></span>
        <strong className={differenceTone(actualTotal, approvedTotal, currency)}>{varianceLabel(actualTotal, approvedTotal, currency)}</strong>
      </div>
    </div>
  );
}

function ActualsEditor({ view, submission, claims }: { view: PbxBudgetView; submission: PbxActuals; claims: ClaimOption[] }) {
  const currency = view.budget!.currency;
  const [lines, setLines] = useState<Line[]>(() => toLines(submission, view.categories));
  const [confirmed, setConfirmed] = useState(submission.complete_confirmed);
  const [varianceNote, setVarianceNote] = useState(submission.variance_note ?? "");
  const [rv, setRv] = useState(submission.row_version);
  const [dirty, setDirty] = useState(false);
  const [newCategory, setNewCategory] = useState(view.categories.find((c) => c.key === "other")?.id ?? view.categories[0]?.id ?? "");
  const save = useAction();
  const submit = useAction();
  const busy = save.pending || submit.pending;
  const touch = () => setDirty(true);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (key: string, patch: Partial<Line>) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); touch(); };
  const approvedTotal = view.baseline;
  const entered = lines.map((l) => amountOf(l.actual));
  const actualTotal = sumMoney(entered, currency);
  const blank = lines.filter((l, i) => entered[i] === null).length;
  const needNote = requiresVarianceNote(approvedTotal, actualTotal, currency);
  const groupSum = new Map<string, number>();
  lines.forEach((l, i) => { const v = entered[i]; if (l.budget_row_id && v !== null && v !== undefined) groupSum.set(l.budget_row_id, sumMoney([groupSum.get(l.budget_row_id) ?? 0, v], currency)); });

  const split = (l: Line) => {
    const next: Line = { ...l, key: newKey(), line_no: Math.max(...lines.filter((x) => x.budget_row_id === l.budget_row_id).map((x) => x.line_no)) + 1, approved: 0, actual: "", paid_via: "", paid_by: "", claim_id: "", foreign_currency: false, foreign_note: "", note: "" };
    setLines((ls) => { const i = ls.map((x) => x.key).lastIndexOf(ls.filter((x) => x.budget_row_id === l.budget_row_id).at(-1)!.key); return [...ls.slice(0, i + 1), next, ...ls.slice(i + 1)]; });
    touch();
  };
  const addUnplanned = () => {
    const c = view.categories.find((x) => x.id === newCategory);
    setLines((ls) => [...ls, { key: newKey(), budget_row_id: null, line_no: 1, category_id: newCategory, category_label: c?.label ?? "", description: "", approved: 0, actual: "", paid_via: "", paid_by: "", claim_id: "", foreign_currency: false, foreign_note: "", note: "", unplanned: true }]);
    touch();
  };
  const remove = (key: string) => { setLines((ls) => ls.filter((l) => l.key !== key)); touch(); };

  const rowsPayload = () => lines.map((l) => ({
    budget_row_id: l.budget_row_id, category_id: l.category_id || null, description: l.description, actual_amount: l.actual === "" ? null : l.actual, paid_via: l.paid_via || null,
    paid_by_user_id: l.paid_by || null, claim_id: l.claim_id || null, foreign_currency: l.foreign_currency, foreign_note: l.foreign_note || null, note: l.note || null,
  }));
  const header = { projectId: view.project.id, submissionId: submission.id, completeConfirmed: confirmed, varianceNote: varianceNote || null };
  const doSave = () => save.run(() => saveActualsDraft({ ...header, expected: rv, rows: rowsPayload() }), (r) => { if (r.version !== undefined) setRv(r.version); setDirty(false); }, "Draft saved.");
  const doSubmit = () =>
    submit.run(async () => {
      const saved = await saveActualsDraft({ ...header, expected: rv, rows: rowsPayload() });
      if (saved.error) return saved;
      const v = saved.version ?? rv;
      setRv(v);
      return submitActuals({ projectId: view.project.id, submissionId: submission.id, expected: v, requestId: submit.getRequestId() });
    }, () => setDirty(false), "Submitted for approval.");

  const claimOptions = claims;
  return (
    <div className="space-y-4">
      <Alert role="note" className="text-sm">
        Enter what was actually spent. Approved amounts are shown for comparison only and are <strong>never</strong> copied in as actuals. Leave a line empty until you know it; type <strong>0</strong> if nothing was spent. Receipts are handed to Finance in person; nothing is uploaded here.
      </Alert>
      <ul className="space-y-2">
        {lines.map((l, i) => {
          const val = entered[i];
          const sum = l.budget_row_id ? groupSum.get(l.budget_row_id) : undefined;
          const showDetails = val !== null && val !== undefined && val > 0;
          const needsPerson = l.paid_via !== "" && PAID_VIA_NEEDS_PERSON[l.paid_via];
          const base = `${l.key}`;
          return (
            <li key={l.key} className="rounded-lg border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_auto_minmax(0,11rem)_minmax(0,10rem)] sm:items-end">
                <div className="min-w-0">
                  <div className="text-[13px] text-muted-foreground">{l.category_label}{l.line_no > 1 ? ` · part ${l.line_no}` : ""}</div>
                  {l.unplanned ? (
                    <Input aria-label="Describe the unplanned expense" placeholder="What was this expense?" value={l.description} maxLength={300} disabled={busy} onChange={(e) => update(l.key, { description: e.target.value })} />
                  ) : (
                    <div className="text-sm font-medium">{l.description}</div>
                  )}
                  {l.unplanned ? <div className="mt-0.5 text-[13px] text-[hsl(var(--os-amber))]">Not in the approved budget</div> : null}
                </div>
                <div className="text-sm sm:text-right">
                  <div className="text-[13px] text-muted-foreground">Approved</div>
                  <div className="tabular-nums">{l.line_no === 1 ? money(l.approved, currency) : "—"}</div>
                </div>
                <Field label={`Actual (${currency})`} htmlFor={`${base}-amt`}>
                  <Input id={`${base}-amt`} inputMode="decimal" placeholder="Not entered" value={l.actual} disabled={busy} onChange={(e) => update(l.key, { actual: cleanDecimal(e.target.value) })} />
                </Field>
                <div className="text-sm sm:text-right">
                  <div className="text-[13px] text-muted-foreground">Difference</div>
                  <div className={`tabular-nums ${l.budget_row_id && l.line_no === 1 && sum !== undefined ? differenceTone(sum, l.approved, currency) : ""}`}>
                    {l.budget_row_id ? (l.line_no === 1 && sum !== undefined ? differenceText(sum, l.approved, currency) : "—") : val === null || val === undefined ? "—" : differenceText(val, 0, currency)}
                  </div>
                </div>
              </div>
              {showDetails ? (
                <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-[minmax(15rem,1.3fr)_minmax(9rem,1fr)_minmax(0,2fr)]">
                  <Field label="How was it paid?" htmlFor={`${base}-via`}>
                    <Select id={`${base}-via`} value={l.paid_via} disabled={busy} onChange={(e) => update(l.key, { paid_via: e.target.value as PaidVia | "" })}>
                      <option value="">Choose…</option>
                      {PAID_VIA.map((p) => <option key={p} value={p}>{PAID_VIA_LABELS[p]}</option>)}
                    </Select>
                  </Field>
                  {needsPerson ? (
                    <Field label="Who paid?" htmlFor={`${base}-by`}>
                      <Select id={`${base}-by`} value={l.paid_by} disabled={busy} onChange={(e) => update(l.key, { paid_by: e.target.value })}>
                        <option value="">Choose…</option>
                        {view.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </Field>
                  ) : null}
                  {l.paid_via === "existing_claim" ? (
                    <Field label="Your expense claim" htmlFor={`${base}-claim`} hint="This only links the claim. It is not paid twice, and the claim itself is not changed.">
                      <Select id={`${base}-claim`} value={l.claim_id} disabled={busy} onChange={(e) => update(l.key, { claim_id: e.target.value })}>
                        <option value="">Not listed — I will write the reference in the note</option>
                        {claimOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </Select>
                    </Field>
                  ) : null}
                  <Field label="Note (optional)" htmlFor={`${base}-note`} className="sm:col-span-2 lg:col-span-1"><Input id={`${base}-note`} value={l.note} maxLength={500} disabled={busy} onChange={(e) => update(l.key, { note: e.target.value })} /></Field>
                  <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                    <label className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={l.foreign_currency} disabled={busy} onChange={(e) => update(l.key, { foreign_currency: e.target.checked })} />This was paid in another currency</label>
                    {l.foreign_currency ? (
                      <Field label={`Original amount, currency and rate (the line above is in ${currency})`} htmlFor={`${base}-fx`} hint="Nothing is converted for you. Write what you paid and the rate used, for example “EUR 10.00 at 4.00”.">
                        <Input id={`${base}-fx`} value={l.foreign_note} maxLength={500} disabled={busy} onChange={(e) => update(l.key, { foreign_note: e.target.value })} />
                      </Field>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {l.budget_row_id ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => split(l)}><SplitSquareHorizontal className="h-4 w-4" aria-hidden />Split into another payment</Button> : null}
                {l.unplanned || l.line_no > 1 ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => remove(l.key)}><Trash2 className="h-4 w-4" aria-hidden />Remove this line</Button> : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">
        <Field label="Add an expense that was not in the budget" htmlFor="pbx-unp-cat">
          <Select id="pbx-unp-cat" value={newCategory} disabled={busy} onChange={(e) => setNewCategory(e.target.value)}>
            {view.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
        <Button type="button" variant="outline" disabled={busy} onClick={addUnplanned}><Plus className="h-4 w-4" aria-hidden />Add unplanned expense</Button>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={confirmed} disabled={busy} onChange={(e) => { setConfirmed(e.target.checked); touch(); }} /><span>I confirm these actual expenses are complete: nothing else was spent on this project.</span></label>
        {needNote ? (
          <Field label="Why is the total more than 10% away from the approved budget?" htmlFor="pbx-vn" hint="The approver needs a short explanation for a material difference.">
            <Textarea id="pbx-vn" rows={3} value={varianceNote} maxLength={2000} disabled={busy} onChange={(e) => { setVarianceNote(e.target.value); touch(); }} />
          </Field>
        ) : (
          <Field label="Note for the approver (optional)" htmlFor="pbx-vn"><Textarea id="pbx-vn" rows={2} value={varianceNote} maxLength={2000} disabled={busy} onChange={(e) => { setVarianceNote(e.target.value); touch(); }} /></Field>
        )}
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
        <div className="min-w-0 text-sm">
          <div>Approved budget <strong className="tabular-nums">{money(approvedTotal, currency)}</strong></div>
          <div>Actual expenses <strong className="tabular-nums">{money(actualTotal, currency)}</strong> · <span className={differenceTone(actualTotal, approvedTotal, currency)}>{varianceLabel(actualTotal, approvedTotal, currency)}</span></div>
          {blank > 0 ? <div className="text-[13px] text-[hsl(var(--os-amber))]">{blank} line{blank === 1 ? " is" : "s are"} not entered yet. An empty line is not counted as zero.</div> : null}
          {dirty ? <div className="text-[13px] text-muted-foreground">Unsaved changes</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={doSave} disabled={busy}>{save.pending ? "Saving…" : "Save draft"}</Button>
          <Button type="button" onClick={doSubmit} disabled={busy || blank > 0 || !confirmed || (needNote && varianceNote.trim() === "")} title={blank > 0 ? "Enter every line (0 if nothing was spent)" : !confirmed ? "Confirm the expenses are complete" : needNote && varianceNote.trim() === "" ? "Explain the difference" : undefined}>
            {submit.pending ? "Submitting…" : "Submit final expenses"}
          </Button>
        </div>
      </div>
      <div aria-live="polite"><ActionMessage error={save.error ?? submit.error} notice={save.notice ?? submit.notice} /></div>
    </div>
  );
}

function ActualsDecision({ view, s }: { view: PbxBudgetView; s: PbxActuals }) {
  const a = useAction();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
      <p className="text-sm font-medium">Decide these final expenses — actual {money(s.total_actual, view.budget!.currency)} against an approved {money(s.total_approved_budget, view.budget!.currency)}</p>
      {s.variance_note ? <p className="text-sm"><span className="text-muted-foreground">Project Manager&apos;s note: </span>{s.variance_note}</p> : null}
      {asking ? (
        <div className="space-y-2">
          <Field label="What should the Project Manager correct?" htmlFor="pbx-an"><Textarea id="pbx-an" rows={3} value={note} maxLength={1000} autoFocus onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex gap-2">
            <Button type="button" disabled={a.pending || note.trim() === ""} onClick={() => a.run(() => decideActuals({ projectId: view.project.id, submissionId: s.id, decision: "return", note }), () => setAsking(false))}>Return for correction</Button>
            <Button type="button" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={a.pending} onClick={() => a.run(() => decideActuals({ projectId: view.project.id, submissionId: s.id, decision: "approve" }))}>{a.pending ? "Saving…" : "Approve final expenses"}</Button>
          <Button type="button" variant="outline" disabled={a.pending} onClick={() => setAsking(true)}>Return for correction</Button>
        </div>
      )}
      <p className="text-[13px] text-muted-foreground">Nobody can approve expenses they entered or submitted. Receipts are confirmed separately by Finance, on the Settlement tab.</p>
      <ActionMessage error={a.error} />
    </div>
  );
}

function ReturnApproved({ view, s }: { view: PbxBudgetView; s: PbxActuals }) {
  const a = useAction();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  if (!asking) return <Button type="button" variant="outline" size="sm" onClick={() => setAsking(true)}>Return for correction…</Button>;
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <Field label="Why do these approved expenses need correcting?" htmlFor="pbx-ra"><Textarea id="pbx-ra" rows={2} value={reason} maxLength={1000} autoFocus onChange={(e) => setReason(e.target.value)} /></Field>
      <p className="text-[13px] text-muted-foreground">The approved version stays on record; the Project Manager corrects a new draft and Finance approves it again. Settlement figures follow the newly approved version.</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={a.pending || reason.trim() === ""} onClick={() => a.run(() => returnApprovedActuals({ projectId: view.project.id, submissionId: s.id, reason }), () => setAsking(false))}>Return to the Project Manager</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
      </div>
      <ActionMessage error={a.error} />
    </div>
  );
}

/** Actual expenses: manual totals entered by the Project Manager after the project, compared with the approved budget, decided by the routed approver (Finance, or the CEO / CTO when the submitter holds Finance access). */
export function ActualsSection({ view, claims }: { view: PbxBudgetView; claims: ClaimOption[] }) {
  const a = useAction();
  const budget = view.budget!;
  const currency = budget.currency;
  const tz = view.project.site_timezone;
  const list = [...view.actuals].sort((x, y) => y.seq - x.seq);
  const current = list[0];
  const approvedBaseline = view.baseline > 0;
  const isPm = view.viewer.is_pm;
  const open = budget.settlement_status === "open";

  if (!approvedBaseline && list.length === 0) {
    return <Muted>Actual expenses are entered after the budget is approved. Nothing to enter yet.</Muted>;
  }
  return (
    <div className="space-y-4">
      {!current && isPm && open ? (
        <Panel title="Enter the actual expenses" description="After the project, enter what was really spent, line by line, next to the approved budget.">
          <div className="space-y-2">
            <Button type="button" disabled={a.pending} onClick={() => a.run(() => startActuals({ projectId: view.project.id, budgetId: budget.id }))}>{a.pending ? "Starting…" : "Start entering actual expenses"}</Button>
            <ActionMessage error={a.error} />
          </div>
        </Panel>
      ) : null}
      {!current && !isPm ? <Muted>The Project Manager has not entered the actual expenses yet.</Muted> : null}

      {current && current.status === "draft" && isPm ? (
        <Panel title="Actual expenses (draft)" description={`Compared with the approved budget of ${money(view.baseline, currency)}. Nothing is sent for approval until you submit.`}>
          <ActualsEditor key={`${current.id}:${current.row_version}`} view={view} submission={current} claims={claims} />
        </Panel>
      ) : null}

      {current && current.status === "returned" && isPm && open ? (
        <Alert role="status" className="text-sm">
          <strong>{current.decided_by_name ?? "The approver"} returned these expenses.</strong> {current.decision_note}
          <div className="mt-2"><Button type="button" disabled={a.pending} onClick={() => a.run(() => reviseActuals({ projectId: view.project.id, submissionId: current.id }))}>{a.pending ? "Preparing…" : "Make a new draft to correct"}</Button></div>
          <ActionMessage error={a.error} />
        </Alert>
      ) : null}

      {current && current.status === "submitted" ? (
        <>
          <RouteLine route={current.approval_route} />
          {current.on_hold ? <HoldAlert route={current.approval_route} submitterName={current.submitted_by_name} /> : null}
          {current.i_can_decide ? <ActualsDecision view={view} s={current} /> : null}
          {!current.i_can_decide && !current.on_hold && (view.viewer.user_id === current.created_by || view.viewer.user_id === current.submitted_by) && (view.viewer.is_finance || view.viewer.is_executive) ? <Muted>You entered or submitted these, so someone else decides them.</Muted> : null}
        </>
      ) : null}

      {list.map((s, i) => (
        <Panel
          key={s.id}
          title={`Final expenses${list.length > 1 ? ` — submission ${s.seq}` : ""}`}
          description={s.submitted_at ? `Submitted ${stamp(s.submitted_at, tz)} by ${s.submitted_by_name ?? "—"}${s.decided_at ? ` · Decided ${stamp(s.decided_at, tz)} by ${s.decided_by_name ?? "Finance"}` : ""}` : "Draft"}
          actions={<StatusPill status={s.status} />}
          className={i === 0 && s.status === "draft" && isPm ? "hidden" : undefined}
        >
          <div className="space-y-3">
            {s.decision_note ? <Alert role="status" className="text-sm"><strong>{s.decided_by_name ?? "The approver"} said:</strong> {s.decision_note}</Alert> : null}
            {s.variance_note ? <p className="text-sm"><span className="text-muted-foreground">Project Manager&apos;s note on the difference: </span>{s.variance_note}</p> : null}
            <ActualsTable rows={s.rows} currency={currency} approvedTotal={s.total_approved_budget} actualTotal={s.total_actual} />
            {s.status === "approved" && i === 0 && view.viewer.is_finance && open ? <ReturnApproved view={view} s={s} /> : null}
          </div>
        </Panel>
      ))}
    </div>
  );
}
