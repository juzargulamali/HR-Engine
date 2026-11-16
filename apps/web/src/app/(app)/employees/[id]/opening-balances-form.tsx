"use client";

import { useActionState } from "react";
import { recordOpeningBalances } from "@/lib/actions/employeeSetup";
import type { ActionState } from "@/lib/actions/companies";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoHint } from "@/components/ui/info-hint";

const initialState: ActionState = { error: null };

/**
 * The "Opening balances" setup step: carried-over annual leave and comp days, recorded once. Collapsed on the Leave tab unless the person came from the setup
 * step. The employee and company stay visible, and the effect of saving is stated beside the button. A kind already on the ledger is shown as recorded and its
 * field is withheld, so it cannot be posted again.
 */
export function OpeningBalancesCard({
  employeeId,
  employeeName,
  companyName,
  leaveRecorded,
  compRecorded,
  open,
}: {
  employeeId: string;
  employeeName: string;
  companyName: string;
  leaveRecorded: boolean;
  compRecorded: boolean;
  open: boolean;
}) {
  const [state, formAction, pending] = useActionState(recordOpeningBalances, initialState);
  const submitted = state !== initialState;
  const saved = submitted && !state.error;
  const bothRecorded = leaveRecorded && compRecorded;

  return (
    <details id="opening-balances" open={open || submitted} className="rounded-md border border-border p-3" data-testid="opening-balances-card">
      <summary className="cursor-pointer text-sm font-medium">
        Opening balances {bothRecorded ? "(recorded)" : "(optional)"}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground" data-testid="opening-balances-context">
          For <span className="font-medium text-foreground">{employeeName}</span> · {companyName}
        </p>
        {bothRecorded ? (
          <p className="text-sm">Opening balances were recorded once and are not repeated. Use a leave adjustment for any later correction.</p>
        ) : (
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="employeeId" value={employeeId} />
            <p className="flex items-center gap-1 text-sm">
              Only for a mid-year hire or a transfer who already has leave or comp days from elsewhere.
              <InfoHint label="Opening balances">
                <p>Leave a field empty for a fresh start. The entries are dated the hire date and are recorded once: the leave accrual uses them as the starting point, so they cannot be entered a second time.</p>
              </InfoHint>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {leaveRecorded ? (
                <p className="text-sm text-muted-foreground">Annual leave opening balance: recorded.</p>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="openingAnnualLeaveDays">Annual leave balance (days)</Label>
                  <Input id="openingAnnualLeaveDays" name="openingAnnualLeaveDays" type="number" inputMode="decimal" min={0} step={0.5} placeholder="0" />
                </div>
              )}
              {compRecorded ? (
                <p className="text-sm text-muted-foreground">Comp days opening balance: recorded.</p>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="openingCompDays">Comp days earned to date</Label>
                  <Input id="openingCompDays" name="openingCompDays" type="number" inputMode="decimal" min={0} step={0.5} placeholder="0" />
                </div>
              )}
            </div>
            {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
            {saved && !state.warning ? <Alert variant="success">Opening balances recorded.</Alert> : null}
            {saved && state.warning ? <Alert variant="warning">{state.warning}</Alert> : null}
            <p className="text-sm text-muted-foreground">Saving adds the entered balances to {employeeName}&apos;s leave ledger once.</p>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Record opening balances"}
            </Button>
          </form>
        )}
      </div>
    </details>
  );
}
