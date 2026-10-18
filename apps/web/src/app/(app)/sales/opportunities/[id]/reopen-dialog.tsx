"use client";

import { useState } from "react";
import { crmStageLabel } from "@enginious-hr/domain";
import { reopenOpportunity } from "@/lib/actions/crm";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { todayInDubai } from "@/components/sales/format";
import { defaultReopenStage, reopenStageOptions } from "./closure-helpers";

const KINDS = [["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["proposal", "Proposal work"], ["other", "Other"]] as const;

/**
 * Only people holding `reopen_closed` (founders, or someone a founder delegated it to) are offered this; the database
 * checks it again. Nothing is erased: the closure stays in the history.
 */
export function ReopenButton({ opportunityId, version, outcome, stageBeforeClose, hasHandover }: {
  opportunityId: string;
  version: number;
  outcome: "won" | "lost";
  stageBeforeClose: string | null;
  hasHandover: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = reopenStageOptions(stageBeforeClose);
  const returnsTo = crmStageLabel(defaultReopenStage(stageBeforeClose));
  const gone = outcome === "won" ? "The purchase order or authorised email" : "The lost reason";
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Reopen</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Reopen this ${outcome === "won" ? "Won" : "Lost"} opportunity`} description="Use this when the outcome was recorded wrongly or the situation has changed.">
        <div className="mb-4 space-y-3 text-sm">
          <div>
            <p className="font-medium">What will happen</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>It returns to <strong>{returnsTo}</strong>{stageBeforeClose ? ", the stage it was closed from," : ""} unless you choose another working stage below.</li>
              <li>It becomes active again and needs the new next action you enter below.</li>
              <li>{gone} is taken off the live record because it becomes history. {outcome === "won" ? "Winning it again needs evidence again." : "Closing it again needs a reason again."}</li>
            </ul>
          </div>
          <div>
            <p className="font-medium">What will not happen</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Nothing is erased. The closure stays in the history: the outcome, the {outcome === "won" ? "evidence" : "lost reason"}, who closed it and when. Your reason is recorded beside it.</li>
              <li>The follow-ups that were cancelled when it was closed stay cancelled.</li>
              {hasHandover ? <li>The handover that was already prepared is left exactly as it is and is not redone. Nothing is sent to the Project Manager; tell them yourself if needed.</li> : null}
              <li>Nothing is sent to the client.</li>
            </ul>
          </div>
        </div>
        <ActionForm action={reopenOpportunity} submitLabel="Reopen opportunity" pendingLabel="Reopening…" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="id" value={opportunityId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <Field label="Why is it being reopened?" htmlFor="reopen-reason" hint="Required. Kept in the history with your name.">
            <Textarea id="reopen-reason" name="reason" rows={3} required />
          </Field>
          <Field label="Reopen into stage" htmlFor="reopen-stage" hint="Working stages only. It cannot be reopened straight into On hold, Won or Lost.">
            <Select id="reopen-stage" name="toStage" defaultValue={defaultReopenStage(stageBeforeClose)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </Field>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">New next action</legend>
            <Field label="What needs to happen" htmlFor="reopen-title"><Input id="reopen-title" name="nextTitle" required placeholder="e.g. Call to confirm the revised order" /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date" htmlFor="reopen-date"><Input id="reopen-date" name="nextDate" type="date" required min={todayInDubai()} /></Field>
              <Field label="Time (Dubai)" htmlFor="reopen-time"><Input id="reopen-time" name="nextTime" type="time" defaultValue="10:00" /></Field>
              <Field label="Type" htmlFor="reopen-kind">
                <Select id="reopen-kind" name="nextKind" defaultValue="call">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
              </Field>
            </div>
          </fieldset>
          <Alert role="note">If someone else changed this opportunity since you opened the page, the reopen is refused so nothing is overwritten; reload and try again.</Alert>
        </ActionForm>
      </Modal>
    </>
  );
}
