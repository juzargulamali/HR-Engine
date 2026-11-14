"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { saveCrmSettings } from "@/lib/actions/crm";
import type { ActionState } from "@/lib/actions/companies";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OsBadge } from "@/components/os/pills";
import { Panel } from "@/components/projects/parts";
import { Field } from "@/components/sales/action-form";
import { confirmDiscard, useUnsavedChanges } from "@/components/workspace/unsaved";
import { SECTION } from "./blockers";
import { APPROVAL_POLICY_EXPLANATION, APPROVAL_POLICY_LABEL, type ApprovalPolicyValue } from "./approval-policy";

export type { ApprovalPolicyValue };

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

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" },
  { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 0, label: "Sun" },
];

/** The three groups of one company's settings. One save writes all three (crm_upsert_settings takes them together), so the result says which of them had changes. */
export type SettingsSection = "response" | "approval" | "estimates";
export const SECTION_NAME: Record<SettingsSection, string> = { response: "Response targets", approval: "Commercial approval", estimates: "Estimates & VAT" };
const lower = (s: SettingsSection) => SECTION_NAME[s].charAt(0).toLowerCase() + SECTION_NAME[s].slice(1);
const listOf = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** What the page says after a save: the company, which sections had changes, and that the one save wrote every section. Pure, so it is tested. */
export function savedMessage(companyName: string, changed: readonly SettingsSection[], firstSave: boolean): string {
  if (firstSave) return `Sales is set up for ${companyName}: response targets, commercial approval and the reference code and currency were saved together. Enquiries can now be recorded for it.`;
  if (changed.length === 0) return `Saved for ${companyName}. Nothing had been changed, so the settings are as they were.`;
  return `Saved for ${companyName}: ${listOf(changed.map(lower))}. One save writes every section of this page except the VAT choices, which save as each one is added.`;
}

/** Which field a refused save is about, so the message appears beside it (the server returns one sentence). Null = it is shown beside the Save button that was pressed. */
export type SettingsField = "referenceCode" | "currency" | "responseTargetHours" | "calendar" | "holidays" | "duplicateWindowDays" | "approvalPolicy";
export function fieldOfError(message: string): SettingsField | null {
  if (/reference code/i.test(message)) return "referenceCode";
  if (/currency/i.test(message)) return "currency";
  if (/holiday/i.test(message)) return "holidays";
  if (/working (calendar|hours|days)/i.test(message)) return "calendar";
  if (/approval|policy/i.test(message)) return "approvalPolicy";
  if (/duplicate/i.test(message)) return "duplicateWindowDays";
  if (/response|target/i.test(message)) return "responseTargetHours";
  return null;
}
const SECTION_OF_FIELD: Record<SettingsField, SettingsSection> = { referenceCode: "estimates", currency: "estimates", duplicateWindowDays: "estimates", responseTargetHours: "response", calendar: "response", holidays: "response", approvalPolicy: "approval" };

const initialState: ActionState = { error: null };

/**
 * One company's Sales settings in three groups: Response targets, Commercial approval, Estimates & VAT (the reference code and currency; the VAT choices have
 * their own small form under it). Uses its own submit (not <form action>) so a refused save keeps what was typed. Every Save button names the company and
 * its group, and all of them send the same one save: the database function takes every setting together, so the page says so instead of pretending a group
 * is saved alone. The approval policy fields are only rendered, and so only sent, for people allowed to change the policy: the database refuses a policy value
 * from anyone else, and an omitted policy leaves the stored one untouched.
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
  const [clientError, setClientError] = useState<{ message: string; field: SettingsField } | null>(null);
  const [policy, setPolicy] = useState<ApprovalPolicyValue>(initial.approvalPolicy);
  // Which sections have edits that are not saved, and what the last submit sent (so the result names the right sections and the right button).
  const [dirty, setDirty] = useState<SettingsSection[]>([]);
  const [sent, setSent] = useState<{ sections: SettingsSection[]; from: SettingsSection; first: boolean } | null>(null);
  const [handled, setHandled] = useState<ActionState>(initialState);
  const id = (name: string) => `${name}-${companyId}`;

  // A finished save: on success nothing is unsaved any more. (Adjusting state while rendering, as React documents for "state from a changed prop".)
  if (state !== handled) {
    setHandled(state);
    if (state.error === null) setDirty([]);
  }
  const serverError = !pending && state !== initialState && state.error ? state.error : null;
  const error = clientError ?? (serverError ? { message: serverError, field: fieldOfError(serverError) } : null);
  const saved = !pending && !clientError && state !== initialState && state.error === null && sent !== null && dirty.length === 0;
  const errorSection: SettingsSection | null = error ? (error.field ? SECTION_OF_FIELD[error.field] : sent?.from ?? "estimates") : null;

  useUnsavedChanges(`sales-settings-${companyId}`, dirty.length > 0);
  // Choosing another company, or any other link, would throw the edits away without a word (a link inside the app does not reload the page): ask first.
  useEffect(() => {
    if (dirty.length === 0) return undefined;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a || a.getAttribute("href")?.startsWith("#") || a.getAttribute("target") === "_blank") return;
      if (!confirmDiscard(`You have changes to the Sales settings of ${companyName} that are not saved. Leave without saving them?`)) e.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty.length, companyName]);

  const touch = (section: SettingsSection) => () => { setDirty((d) => (d.includes(section) ? d : [...d, section])); };

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setClientError(null);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const from = (submitter?.dataset.section as SettingsSection | undefined) ?? "estimates";
    const data = new FormData(e.currentTarget);
    const days = data.getAll("workdays");
    const start = String(data.get("workStart") ?? "");
    const end = String(data.get("workEnd") ?? "");
    const holidays = String(data.get("holidays") ?? "").trim();
    const given = [days.length > 0, start !== "", end !== ""];
    setSent({ sections: dirty, from, first: !exists });
    if (given.some(Boolean) && !given.every(Boolean)) {
      return setClientError({ field: "calendar", message: "The working calendar needs working days, a start time and an end time together. Fill in all three, or clear them all to leave it not configured." });
    }
    if (!given.some(Boolean) && holidays !== "") {
      return setClientError({ field: "holidays", message: "Holidays only count once working days and hours are set. Add them, or clear the holidays." });
    }
    startTransition(() => formAction(data));
  }

  const fieldError = (field: SettingsField) => (error?.field === field ? <p role="alert" className="text-sm font-medium text-destructive" data-testid={`settings-error-${field}`}>{error.message}</p> : null);

  /** The end of a section: what went wrong (beside the setting when it can be placed, otherwise here), what was saved, and the Save button naming the company. */
  const footer = (section: SettingsSection) => {
    const others = dirty.filter((s) => s !== section);
    return (
      <div className="mt-4 space-y-2 border-t border-border pt-3">
        {error && errorSection === section ? (
          <Alert variant="destructive" data-testid="settings-not-saved">
            <strong>Not saved for {companyName}.</strong> {error.field ? "See the message beside the setting above. " : `${error.message} `}What you typed is still here: correct it and save again.
          </Alert>
        ) : null}
        {error && errorSection !== section && sent?.from === section ? <Alert variant="destructive">Not saved for {companyName}: there is a problem under {SECTION_NAME[errorSection!]}. Nothing on this page was saved.</Alert> : null}
        {saved && sent.from === section ? <Alert variant="success" role="status" data-testid="settings-saved">{savedMessage(companyName, sent.sections, sent.first)}</Alert> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button type="submit" data-section={section} disabled={pending}>{pending && sent?.from === section ? "Saving…" : exists ? `Save ${lower(section)} for ${companyName}` : `Set up Sales for ${companyName}`}</Button>
          {dirty.includes(section) ? <span className="flex items-center gap-1.5 text-sm text-[hsl(var(--os-amber))]"><span className="os-dot" data-tone="amber" aria-hidden />Changes not saved yet</span> : null}
          {others.length > 0 ? <span className="text-sm text-muted-foreground">Also saves your changes under {listOf(others.map((s) => SECTION_NAME[s]))}.</span> : null}
          {!exists ? <span className="text-sm text-muted-foreground">The first save writes every section of this page together.</span> : null}
        </div>
      </div>
    );
  };

  const calendarSet = initial.workdays.length > 0 && initial.workStart !== "" && initial.workEnd !== "";
  const responseBadge = initial.responseTargetHours && calendarSet ? null : <OsBadge tone="amber">{!initial.responseTargetHours && !calendarSet ? "Not configured" : !initial.responseTargetHours ? "No target yet" : "No working calendar yet"}</OsBadge>;

  return (
    <form onSubmit={onSubmit} className="space-y-5" aria-label={`Sales settings for ${companyName}`}>
      <input type="hidden" name="companyId" value={companyId} />

      <Panel id={SECTION.response} title="Response targets" actions={responseBadge}
        hint="How fast a new enquiry should get its first response, and the working hours that time is counted in. Leave them blank for “Not configured”: enquiries still work, and Reports then show elapsed times only, not the share answered within target. The share is worked out once the target and the calendar are both set.">
        <div className="space-y-4" onInput={touch("response")} onChange={touch("response")}>
          <Field label="First-response target (working hours)" htmlFor={id("target")} hint="Leave blank for “Not configured”." help="Response-time figures are only worked out once this and the calendar are both set.">
            <Input id={id("target")} name="responseTargetHours" type="number" inputMode="numeric" min={1} step={1} defaultValue={initial.responseTargetHours ?? ""} placeholder="Not configured" className="max-w-xs" />
            {fieldError("responseTargetHours")}
          </Field>
          <div className="space-y-2">
            <p id={id("days-label")} className="text-sm font-medium">Working days</p>
            <div role="group" aria-labelledby={id("days-label")} className="flex flex-wrap gap-x-4 gap-y-2">
              {WEEKDAYS.map((d) => (
                <label key={d.value} className="flex min-h-9 items-center gap-1.5 text-sm">
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
          {fieldError("calendar")}
          <Field label="Holidays" htmlFor={id("holidays")} hint="Dates like 2026-12-02, separated by commas or spaces." help="Dates when nobody works. Leave the days and times blank and the calendar stays “Not configured”.">
            <Textarea id={id("holidays")} name="holidays" rows={2} defaultValue={initial.holidays} placeholder="2026-12-02, 2026-12-03" />
            {fieldError("holidays")}
          </Field>
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-sm font-medium">
              <input type="checkbox" name="ownerEmailEnabled" defaultChecked={initial.ownerEmailEnabled} className="mt-0.5" />
              <span>Also email follow-up reminders to the opportunity owner</span>
            </label>
            <p className="pl-6 text-sm text-muted-foreground">
              Off by default. Reminders always appear inside Sales. Emails go only to the owner, with the daily run (about 08:00 Dubai time). Sales never sends anything to clients.
              <InfoHint label="Email reminders" className="ml-1">Emails go out only with the daily run, not within minutes of a follow-up falling due, and a failed send is retried on the next daily run. Turn email on only after you have tested that delivery works end to end, because a reminder that never arrives looks like a missed follow-up.</InfoHint>
            </p>
          </div>
        </div>
        {footer("response")}
      </Panel>

      <Panel id={SECTION.approval} title="Commercial approval" actions={(canEditApproval ? policy : initial.approvalPolicy) === "not_configured" ? <OsBadge tone="amber">Not decided</OsBadge> : null}
        hint="Whether a proposal needs a founder's recorded approval before it is treated as approved. Until a policy is chosen nothing can be approved for this company.">
        {canEditApproval ? (
          <div className="space-y-3" onInput={touch("approval")} onChange={touch("approval")}>
            <Field label="Policy" htmlFor={id("policy")}>
              <Select id={id("policy")} name="approvalPolicy" value={policy} onChange={(e) => setPolicy(e.target.value as ApprovalPolicyValue)} className="max-w-md">
                {(Object.keys(APPROVAL_POLICY_LABEL) as ApprovalPolicyValue[]).map((k) => <option key={k} value={k}>{APPROVAL_POLICY_LABEL[k]}</option>)}
              </Select>
              {fieldError("approvalPolicy")}
            </Field>
            {/* The consequence of the choice stays visible: it changes what Sales people can do. */}
            <p className="text-sm">{APPROVAL_POLICY_EXPLANATION[policy]}</p>
            <Field label="Note on the policy (optional)" htmlFor={id("policy-note")} help="Why this was decided, or when it should be reviewed.">
              <Textarea id={id("policy-note")} name="approvalNote" rows={2} defaultValue={initial.approvalNote} />
            </Field>
            {footer("approval")}
          </div>
        ) : (
          <div className="space-y-1 text-sm">
            <p><span className="font-medium">Current policy:</span> {APPROVAL_POLICY_LABEL[initial.approvalPolicy]}</p>
            <p>{APPROVAL_POLICY_EXPLANATION[initial.approvalPolicy]}</p>
            {initial.approvalNote ? <p className="break-words text-muted-foreground">Note: {initial.approvalNote}</p> : null}
            <p className="text-sm text-muted-foreground">Only a founder, or someone they have given approval-rule access, can change this. Saving the other settings leaves it as it is.</p>
          </div>
        )}
      </Panel>

      <Panel id={SECTION.estimates} title="Estimates & VAT" actions={exists ? null : <OsBadge tone="red">Not set up yet</OsBadge>}
        hint="How this company's enquiries and estimates are numbered, the currency a new enquiry starts with, and how far back a new enquiry is checked for a possible duplicate. The VAT choices for estimates are in the block right below and save on their own.">
        <div className="space-y-4" onInput={touch("estimates")} onChange={touch("estimates")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reference code" htmlFor={id("code")} hint="Required. 2 to 5 capital letters." help="Unique across companies. Enquiries are numbered with it, for example OPP-UAE-2026-0042 (the OPP- prefix is added for you).">
              <Input id={id("code")} name="referenceCode" required minLength={2} maxLength={5} pattern="[A-Za-z]{2,5}" defaultValue={initial.referenceCode} autoCapitalize="characters" autoComplete="off" />
              {fieldError("referenceCode")}
            </Field>
            <Field label="Default quote currency" htmlFor={id("currency")} hint="Required. A 3-letter code such as AED." help="New enquiries start with this currency. Any enquiry can use another.">
              <Input id={id("currency")} name="currency" required minLength={3} maxLength={3} pattern="[A-Za-z]{3}" defaultValue={initial.currency} autoCapitalize="characters" autoComplete="off" />
              {fieldError("currency")}
            </Field>
          </div>
          <Field label="Duplicate window (days)" htmlFor={id("window")} hint="1 to 1095." help="How far back a new enquiry is compared with earlier ones when checking for a possible duplicate.">
            <Input id={id("window")} name="duplicateWindowDays" type="number" inputMode="numeric" min={1} max={1095} step={1} required defaultValue={initial.duplicateWindowDays} className="max-w-xs" />
            {fieldError("duplicateWindowDays")}
          </Field>
        </div>
        {footer("estimates")}
      </Panel>
    </form>
  );
}
