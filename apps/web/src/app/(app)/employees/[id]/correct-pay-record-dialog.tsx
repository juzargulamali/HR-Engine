"use client";

import { useActionState, useMemo, useState } from "react";
import { correctPayRecord, type PayCorrectionState } from "@/lib/actions/payCorrection";
import {
  allowanceLabel, longDate, money, payTotal, planPayCorrection,
  type InForce, type PayRecord, type PendingPayChange,
} from "@/lib/hr/payCorrection";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";

const initialState: PayCorrectionState = { error: null };

/** One request key per time the dialog is opened (it is mounted only while open): pressing the button twice, or retrying after a lost answer, can never apply the correction twice. */
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `key-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

const ORDER = ["housing", "transport", "other"];
const keysFor = (a: Record<string, number>) => [...new Set([...Object.keys(a), "other"])].sort((x, y) => (ORDER.indexOf(x) + 1 || 99) - (ORDER.indexOf(y) + 1 || 99) || x.localeCompare(y));

export interface CorrectPayRecordProps {
  employeeId: string;
  employeeName: string;
  companyName: string;
  hireDate: string;
  /** Today's calendar day in the employee's country (the database's answer). */
  today: string;
  record: PayRecord;
  /** Every pay record of this employee, so the review can say which pay is in force before and after. */
  records: PayRecord[];
  /** Scheduled pay changes not yet applied (held ones are not included: they never apply). */
  pending: PendingPayChange[];
}

/**
 * "Correct pay record": opens a dialog for ONE entry of the pay history. Step 1 edits the date and/or the amounts and asks for a reason; step 2 REVIEWS the old and new values side by side, and says what
 * pay is in force today before and after; only then is "Confirm correction" offered. The original stays on the entry afterwards. Update pay is separate and unchanged: it is for raises, promotions and
 * scheduled changes, this is only for a record that was entered wrongly.
 */
export function CorrectPayRecordButton(props: CorrectPayRecordProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid={`correct-pay-${props.record.id}`}>Correct pay record</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="wide"
        title="Correct pay record"
        description={`${props.employeeName} · ${props.companyName}`}
        help={<p>Use this only when a pay record was entered wrongly, for example the current salary saved with the joining date. The original figures stay on the entry. For a raise or a promotion use Update pay instead.</p>}
      >
        <CorrectionForm {...props} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function CorrectionForm({ employeeId, hireDate, today, record, records, pending, onDone }: CorrectPayRecordProps & { onDone: () => void }) {
  const [state, formAction, submitting] = useActionState(correctPayRecord, initialState);
  const [requestKey] = useState(newKey);
  const allowanceKeys = useMemo(() => keysFor(record.allowances), [record.allowances]);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [touched, setTouched] = useState(false);
  const [date, setDate] = useState(record.effective_from);
  const [basic, setBasic] = useState(String(record.base_salary));
  const [allow, setAllow] = useState<Record<string, string>>(() => Object.fromEntries(allowanceKeys.map((k) => [k, record.allowances[k] !== undefined ? String(record.allowances[k]) : ""])));
  const [reason, setReason] = useState("");

  // The allowances as the record would hold them: every one it already has, plus "Others" only when something is entered for it.
  const newAllowances = useMemo(() => {
    const out: Record<string, number> = {};
    for (const k of allowanceKeys) {
      const raw = allow[k] ?? "";
      if (raw === "") { if (k in record.allowances) out[k] = 0; continue; }
      const n = Number(raw);
      if (k in record.allowances || n > 0 || !Number.isFinite(n)) out[k] = n;
    }
    return out;
  }, [allow, allowanceKeys, record.allowances]);

  const plan = planPayCorrection({ records, recordId: record.id, newDate: date, newBasic: Number(basic), newAllowances, today, hireDate, pending });
  const reasonOk = reason.trim().length >= 5;
  const canReview = plan.ok && reasonOk;
  const changed = <T,>(a: T, b: T) => JSON.stringify(a) !== JSON.stringify(b);
  const touch = () => setTouched(true);

  if (state.saved) {
    return (
      <div className="space-y-3" data-testid="correct-pay-saved">
        <Alert variant="success" role="status">{state.saved.message}</Alert>
        {state.saved.affects.length > 0 ? (
          <Alert variant="warning" data-testid="correct-pay-affects">
            <p className="font-medium">This correction affects:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">{state.saved.affects.map((line) => <li key={line}>{line}</li>)}</ul>
            <p className="mt-2">Nothing in payroll or in a settlement was changed. Review with Finance or payroll.</p>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="correct-pay-no-impact">No approved payroll export or final settlement uses this pay record’s period.</p>
        )}
        <div className="flex justify-end"><Button type="button" onClick={onDone}>Close</Button></div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-4"
      data-testid="correct-pay-form"
      onSubmit={(e) => {
        // Enter in a field must never save from the first step: it goes to the review.
        if (step !== "review") { e.preventDefault(); if (canReview) setStep("review"); else setTouched(true); }
      }}
    >
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="compensationId" value={record.id} />
      <input type="hidden" name="requestKey" value={requestKey} />
      <input type="hidden" name="effectiveDate" value={date} />
      <input type="hidden" name="basicSalary" value={basic} />
      <input type="hidden" name="allowances" value={JSON.stringify(newAllowances)} />
      <input type="hidden" name="reason" value={reason} />

      {step === "edit" ? (
        <>
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-testid="correct-pay-which">
            Correcting the pay record that starts on <span className="font-medium">{longDate(record.effective_from)}</span>: {money(record.base_salary, record.currency)} basic, {money(payTotal(record.base_salary, record.allowances), record.currency)} in total{record.is_current ? " (in force today)" : ""}.
          </p>
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="correct-date">Effective date</Label>
            <Input id="correct-date" type="date" required value={date} min={hireDate} max={record.effective_from > today ? record.effective_from : today} onChange={(e) => { setDate(e.target.value); touch(); }} />
            <p className="text-xs text-muted-foreground">The day this pay really took effect. Not before the hire date ({longDate(hireDate)}) and not after today.</p>
          </div>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Pay</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="correct-basic">Basic salary</Label>
                <Input id="correct-basic" type="number" step="0.01" min="0" inputMode="decimal" required value={basic} onChange={(e) => { setBasic(e.target.value); touch(); }} />
              </div>
              {allowanceKeys.map((k) => (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`correct-allow-${k}`}>{allowanceLabel(k)}</Label>
                  <Input id={`correct-allow-${k}`} type="number" step="0.01" min="0" inputMode="decimal" placeholder="0" value={allow[k] ?? ""} onChange={(e) => { setAllow((a) => ({ ...a, [k]: e.target.value })); touch(); }} />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label htmlFor="correct-currency">Currency</Label>
                <Input id="correct-currency" value={record.currency} readOnly aria-readonly="true" />
              </div>
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="correct-reason">Reason for the correction</Label>
            <Textarea id="correct-reason" rows={3} maxLength={500} required value={reason} onChange={(e) => { setReason(e.target.value); touch(); }} placeholder="e.g. The current salary was entered with the joining date instead of the date it started" />
            <p className="text-xs text-muted-foreground">Kept with the record. At least 5 characters.</p>
          </div>
          {touched && !plan.ok ? <Alert variant="warning" role="status" data-testid="correct-pay-problem">{plan.error}</Alert> : null}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
            <Button type="button" disabled={!canReview} onClick={() => setStep("review")} data-testid="correct-pay-review">Review correction</Button>
          </div>
        </>
      ) : (
        plan.ok ? (
          <>
            <p className="text-sm">Check the change below. Nothing is saved until you confirm.</p>
            <table className="w-full text-sm" data-testid="correct-pay-compare">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-normal"><span className="sr-only">Item</span></th>
                  <th scope="col" className="py-1 pr-3 font-medium">On record now</th>
                  <th scope="col" className="py-1 font-medium">After the correction</th>
                </tr>
              </thead>
              <tbody>
                <CompareRow label="Effective from" before={longDate(record.effective_from)} after={longDate(date)} different={record.effective_from !== date} />
                <CompareRow label="Basic salary" before={money(record.base_salary, record.currency)} after={money(Number(basic), record.currency)} different={record.base_salary !== Number(basic)} />
                {allowanceKeys.filter((k) => k in record.allowances || k in newAllowances).map((k) => (
                  <CompareRow key={k} label={allowanceLabel(k)} before={money(record.allowances[k] ?? 0, record.currency)} after={money(newAllowances[k] ?? 0, record.currency)} different={(record.allowances[k] ?? 0) !== (newAllowances[k] ?? 0)} />
                ))}
                <CompareRow label="Total" before={money(payTotal(record.base_salary, record.allowances), record.currency)} after={money(payTotal(Number(basic), newAllowances), record.currency)} different={changed(payTotal(record.base_salary, record.allowances), payTotal(Number(basic), newAllowances))} strong />
              </tbody>
            </table>
            <div className="grid gap-2 sm:grid-cols-2" data-testid="correct-pay-in-force">
              <InForceBox title="Pay in force today, before" pay={plan.beforeToday} fallback={record.currency} />
              <InForceBox title="Pay in force today, after" pay={plan.afterToday} fallback={record.currency} />
            </div>
            {plan.uncoveredFrom && plan.uncoveredTo ? (
              <Alert variant="warning" data-testid="correct-pay-gap">
                After this correction no pay record is on file from {longDate(plan.uncoveredFrom)} (the hire date) until {longDate(plan.uncoveredTo)}. The original entry stays on record with the correction.
              </Alert>
            ) : null}
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm"><span className="text-muted-foreground">Reason: </span>{reason.trim()}</div>
            <p className="text-sm text-muted-foreground">The original figures stay on this entry in the history. Payroll exports that are already approved and settlements are never changed by this; if one of them uses this record you will be told after saving.</p>
            {state.error ? <Alert variant="destructive" data-testid="correct-pay-error">{state.error}</Alert> : null}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="outline" onClick={() => setStep("edit")} disabled={submitting}>Back</Button>
              <Button type="submit" disabled={submitting} data-testid="correct-pay-confirm">{submitting ? "Saving…" : "Confirm correction"}</Button>
            </div>
          </>
        ) : (
          <Alert variant="warning">{plan.error} <Button type="button" variant="outline" size="sm" onClick={() => setStep("edit")}>Back</Button></Alert>
        )
      )}
    </form>
  );
}

function CompareRow({ label, before, after, different, strong }: { label: string; before: string; after: string; different: boolean; strong?: boolean }) {
  return (
    <tr className={`border-t border-border ${strong ? "font-medium" : ""}`} data-changed={different ? "true" : "false"}>
      <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">{label}</th>
      <td className="py-1.5 pr-3">{before}</td>
      <td className={`py-1.5 ${different ? "font-medium text-foreground" : "text-muted-foreground"}`}>{after}{different ? <span className="sr-only"> (changed)</span> : null}</td>
    </tr>
  );
}

function InForceBox({ title, pay, fallback }: { title: string; pay: InForce | null; fallback: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2 text-sm">
      <p className="text-xs text-muted-foreground">{title}</p>
      {pay ? (
        <p>{money(payTotal(pay.base_salary, pay.allowances), pay.currency)} <span className="text-muted-foreground">(basic {money(pay.base_salary, pay.currency)}, from {longDate(pay.effective_from)})</span></p>
      ) : (
        <p className="text-muted-foreground">No pay record is in force yet ({fallback})</p>
      )}
    </div>
  );
}
