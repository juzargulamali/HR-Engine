"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { recordEmploymentChange, type EmploymentChangeState } from "@/lib/actions/employmentChanges";
import { planChange } from "@/lib/hr/changes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { InfoHint } from "@/components/ui/info-hint";

const initialState: EmploymentChangeState = { error: null };
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The ONE form for a job title and/or pay change (the Compensation tab's "Change salary" opens this same form). The employee and company stay at the top while editing; the sentence beside
 * the button says what saving will do (in force today, or scheduled with nothing changing until its date) and which of the two will change, before anything is saved.
 */
export function ChangeEmploymentForm({
  employeeId, employeeName, companyName, today, hireDate,
  currentJobTitle, currentBasic, currentOther, currency,
  canChangeTitle, canSchedule, leadWith, firstSalary, startOpen,
}: {
  employeeId: string;
  employeeName: string;
  companyName: string;
  /** Today's calendar day in the employee's country (the server's answer, so the sentence and the saved result agree). */
  today: string;
  hireDate: string;
  currentJobTitle: string | null;
  currentBasic: number | null;
  currentOther: number;
  currency: string;
  /** HR Admin: may change the title, add a note (the audit event) and schedule a later date. Finance: pay only, in force now. */
  canChangeTitle: boolean;
  canSchedule: boolean;
  leadWith: "pay" | "job";
  firstSalary: boolean;
  startOpen: boolean;
}) {
  const [state, formAction, pending] = useActionState(recordEmploymentChange, initialState);
  const [date, setDate] = useState(firstSalary ? hireDate : today);
  const [title, setTitle] = useState("");
  const [basic, setBasic] = useState("");
  const [other, setOther] = useState("");
  const basicRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (startOpen) (leadWith === "pay" ? basicRef : titleRef).current?.focus(); }, [startOpen, leadWith]);

  const plan = planChange({
    effectiveDate: date, today,
    newJobTitle: canChangeTitle ? title : null, currentJobTitle,
    newBasic: basic === "" ? null : Number(basic), newOther: other === "" ? null : Number(other),
    currentBasic, currentOther,
  });
  const total = (basic === "" ? currentBasic ?? 0 : Number(basic) || 0) + (other === "" ? currentOther : Number(other) || 0);
  const effect = !plan.ok
    ? "Nothing to save yet: enter what is changing."
    : plan.when === "scheduled"
      ? `Scheduled: nothing changes until ${longDate(date)}. It is applied automatically that day.`
      : `Takes effect ${date === today ? "today" : `from ${longDate(date)}`}: saved and in force now.`;
  const changing = !plan.ok ? "" : plan.kind === "both" ? "Changes the job title and pay together." : plan.kind === "job" ? "Changes the job title only." : "Changes pay only.";

  const payFields = (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{firstSalary ? "Salary" : "Pay"}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="newBasicSalary">{firstSalary ? "Basic salary" : "New basic salary"}</Label>
          <Input ref={basicRef} id="newBasicSalary" name="newBasicSalary" type="number" step="0.01" min="0" inputMode="decimal" placeholder={currentBasic?.toString() ?? "0"} value={basic} onChange={(e) => setBasic(e.target.value)} required={firstSalary} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newOtherAllowance">{firstSalary ? "Others" : "New others"}</Label>
          <Input id="newOtherAllowance" name="newOtherAllowance" type="number" step="0.01" min="0" inputMode="decimal" placeholder={currentOther.toString()} value={other} onChange={(e) => setOther(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="currency-shown">Currency</Label>
          <Input id="currency-shown" value={currency} readOnly aria-readonly="true" />
        </div>
      </div>
      {basic || other ? <p className="text-sm text-muted-foreground">New total: <span className="font-medium text-foreground">{total.toFixed(2)} {currency}</span></p> : null}
    </fieldset>
  );
  const titleField = canChangeTitle ? (
    <div className="space-y-1.5">
      <Label htmlFor="newJobTitle">New job title</Label>
      <Input ref={titleRef} id="newJobTitle" name="newJobTitle" placeholder={currentJobTitle ?? "e.g. Senior Technician"} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
    </div>
  ) : null;

  return (
    <form action={formAction} className="space-y-4" data-testid="change-employment-form">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-testid="change-employment-who">
        <span className="font-medium">{employeeName}</span> · {companyName}
      </div>

      <div className="max-w-xs space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="effectiveDate">Effective date</Label>
          <InfoHint label="Effective date">
            <p>A change dated today or earlier is applied at once. A later date is scheduled: the record is saved now, nothing changes until that day, and it is applied automatically on the day (in this employee&apos;s country).</p>
            {canSchedule ? null : <p className="mt-1.5">Only an HR Admin can schedule a change for a later date.</p>}
          </InfoHint>
        </div>
        <Input id="effectiveDate" name="effectiveDate" type="date" required value={date} min={hireDate} max={canSchedule ? undefined : today} onChange={(e) => setDate(e.target.value)} />
      </div>

      {leadWith === "pay" ? <>{payFields}{titleField}</> : <>{titleField}{payFields}</>}

      {canChangeTitle ? (
        <div className="space-y-1.5">
          <Label htmlFor="note">Note (optional)</Label>
          <Input id="note" name="note" maxLength={300} placeholder="e.g. Annual review, promoted to team lead" />
        </div>
      ) : null}

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      {state.saved ? <Alert variant={state.saved.status === "scheduled" ? "warning" : undefined} role="status" data-testid="change-employment-saved">{state.saved.message}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <Button type="submit" disabled={pending || !plan.ok}>{pending ? "Saving…" : firstSalary ? "Add salary" : plan.ok && plan.when === "scheduled" ? "Schedule change" : "Save change"}</Button>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground" aria-live="polite" data-testid="change-employment-effect">{effect} {changing}</p>
      </div>
    </form>
  );
}
