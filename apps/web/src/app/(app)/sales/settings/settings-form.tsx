"use client";

import { startTransition, useActionState, useState } from "react";
import { saveCrmSettings } from "@/lib/actions/crm";
import type { ActionState } from "@/lib/actions/companies";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/sales/action-form";

export type ApprovalPolicyValue = "not_configured" | "not_required" | "required";

export interface SettingsInitial {
  referenceCode: string;
  currency: string;
  responseTargetHours: number | null;
  workdays: number[];
  workStart: string;
  workEnd: string;
  holidays: string;
  duplicateWindowDays: number;
  ownerEmailEnabled: boolean;
  approvalPolicy: ApprovalPolicyValue;
  approvalNote: string;
}

export const APPROVAL_POLICY_LABEL: Record<ApprovalPolicyValue, string> = {
  not_configured: "Not configured (nobody has decided yet)",
  not_required: "Not required",
  required: "Required",
};

export const APPROVAL_POLICY_EXPLANATION: Record<ApprovalPolicyValue, string> = {
  not_configured: "Nobody has decided yet. Until a policy is set, nothing can be approved, and no proposal will show as approved.",
  not_required: "A founder has decided proposals do not need internal approval before they are sent.",
  required: "Proposals need a founder's recorded approval before they are treated as approved.",
};

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" },
  { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 0, label: "Sun" },
];

const initialState: ActionState = { error: null };

/**
 * One company's Sales settings. Uses its own submit (not <form action>) so a refused save keeps what was typed.
 * The approval policy fields are only rendered, and so only sent, for people allowed to change the policy: the database
 * refuses a policy value from anyone else, and an omitted policy leaves the stored one untouched.
 */
export function SettingsForm({
  companyId, companyName, exists, initial, canEditApproval,
}: {
  companyId: string;
  companyName: string;
  exists: boolean;
  initial: SettingsInitial;
  canEditApproval: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveCrmSettings, initialState);
  const [clientError, setClientError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<ApprovalPolicyValue>(initial.approvalPolicy);
  const saved = state !== initialState && state.error === null && clientError === null;
  const error = clientError ?? state.error;
  const id = (name: string) => `${name}-${companyId}`;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);
    const data = new FormData(e.currentTarget);
    const days = data.getAll("workdays");
    const start = String(data.get("workStart") ?? "");
    const end = String(data.get("workEnd") ?? "");
    const holidays = String(data.get("holidays") ?? "").trim();
    const given = [days.length > 0, start !== "", end !== ""];
    if (given.some(Boolean) && !given.every(Boolean)) {
      return setClientError("The working calendar needs working days, a start time and an end time together. Fill in all three, or clear them all to leave it not configured.");
    }
    if (!given.some(Boolean) && holidays !== "") {
      return setClientError("Holidays only count once working days and hours are set. Add them, or clear the holidays.");
    }
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" aria-label={`Sales settings for ${companyName}`}>
      <input type="hidden" name="companyId" value={companyId} />

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Enquiry references and currency</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reference code" htmlFor={id("code")} hint="2 to 5 capital letters, unique across companies. Enquiries are numbered with it, for example UAE-2026-0042.">
            <Input id={id("code")} name="referenceCode" required minLength={2} maxLength={5} pattern="[A-Za-z]{2,5}" defaultValue={initial.referenceCode} autoCapitalize="characters" autoComplete="off" />
          </Field>
          <Field label="Default quote currency" htmlFor={id("currency")} hint="New enquiries start with this currency. Any enquiry can use another.">
            <Input id={id("currency")} name="currency" required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" defaultValue={initial.currency} autoCapitalize="characters" autoComplete="off" />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Response target and working calendar</legend>
        <Field label="First-response target (working hours)" htmlFor={id("target")} hint="Leave blank for “Not configured”. Response-time figures are only worked out once this and the calendar are both set.">
          <Input id={id("target")} name="responseTargetHours" type="number" inputMode="numeric" min={1} step={1} defaultValue={initial.responseTargetHours ?? ""} placeholder="Not configured" className="max-w-xs" />
        </Field>
        <div className="space-y-2">
          <p id={id("days-label")} className="text-sm font-medium">Working days</p>
          <div role="group" aria-labelledby={id("days-label")} className="flex flex-wrap gap-x-4 gap-y-2">
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="workdays" value={d.value} defaultChecked={initial.workdays.includes(d.value)} /> {d.label}
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Working day starts (Dubai time)" htmlFor={id("start")}>
            <Input id={id("start")} name="workStart" type="time" defaultValue={initial.workStart} />
          </Field>
          <Field label="Working day ends (Dubai time)" htmlFor={id("end")}>
            <Input id={id("end")} name="workEnd" type="time" defaultValue={initial.workEnd} />
          </Field>
        </div>
        <Field label="Holidays" htmlFor={id("holidays")} hint="Dates when nobody works, like 2026-12-02, separated by commas or spaces. Leave the days and times blank and the calendar stays “Not configured”.">
          <Textarea id={id("holidays")} name="holidays" rows={2} defaultValue={initial.holidays} placeholder="2026-12-02, 2026-12-03" />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Duplicate warnings and reminders</legend>
        <Field label="Duplicate window (days)" htmlFor={id("window")} hint="How far back a new enquiry is compared with earlier ones when checking for a possible duplicate. 1 to 1095.">
          <Input id={id("window")} name="duplicateWindowDays" type="number" inputMode="numeric" min={1} max={1095} step={1} required defaultValue={initial.duplicateWindowDays} className="max-w-xs" />
        </Field>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" name="ownerEmailEnabled" defaultChecked={initial.ownerEmailEnabled} className="mt-0.5" />
            <span>Also email follow-up reminders to the opportunity owner</span>
          </label>
          <p className="pl-6 text-xs text-muted-foreground">
            Off by default. Reminders always appear inside Sales. Turn email on only after you have tested that delivery works end to end, because a reminder that never arrives looks like a missed follow-up. Sales never sends anything to clients.
          </p>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Commercial approval policy</legend>
        {canEditApproval ? (
          <>
            <Field label="Policy" htmlFor={id("policy")}>
              <Select id={id("policy")} name="approvalPolicy" value={policy} onChange={(e) => setPolicy(e.target.value as ApprovalPolicyValue)} className="max-w-md">
                {(Object.keys(APPROVAL_POLICY_LABEL) as ApprovalPolicyValue[]).map((k) => <option key={k} value={k}>{APPROVAL_POLICY_LABEL[k]}</option>)}
              </Select>
            </Field>
            <p className="text-sm">{APPROVAL_POLICY_EXPLANATION[policy]}</p>
            <Field label="Note on the policy (optional)" htmlFor={id("policy-note")} hint="Why this was decided, or when it should be reviewed.">
              <Textarea id={id("policy-note")} name="approvalNote" rows={2} defaultValue={initial.approvalNote} />
            </Field>
          </>
        ) : (
          <div className="space-y-1 text-sm">
            <p><span className="font-medium">Current policy:</span> {APPROVAL_POLICY_LABEL[initial.approvalPolicy]}</p>
            <p>{APPROVAL_POLICY_EXPLANATION[initial.approvalPolicy]}</p>
            {initial.approvalNote ? <p className="break-words text-muted-foreground">Note: {initial.approvalNote}</p> : null}
            <p className="text-xs text-muted-foreground">Only a founder, or someone they have given approval-rule access, can change this. Saving the other settings leaves it as it is.</p>
          </div>
        )}
      </fieldset>

      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {saved ? <Alert variant="success" role="status">Settings saved for {companyName}.</Alert> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : exists ? "Save settings" : "Set up Sales for this company"}</Button>
    </form>
  );
}
