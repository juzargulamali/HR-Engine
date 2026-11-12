"use client";

import { useState } from "react";
import { answerOpsQuestion, removeOpsPlanning, setOpsPlanning } from "@/lib/actions/crmOps";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { OPS_DATES_TENTATIVE, OPS_NOTE_HINT, OPS_READS_FROM_ENQUIRY, OPS_TEAMS, OPS_TEAM_LABELS, OPS_TEXT_MAX } from "@/lib/crm/ops-planning";

export interface OpsPlanningValues {
  decisionDate: string | null;
  datesTentative: boolean;
  dismantleDate: string | null;
  teams: readonly string[];
  toConfirm: string | null;
  note: string | null;
}

interface Target { opportunityId: string; version: number }

/**
 * One dialog for both moments: flagging the enquiry for the first time ("flag") and changing the details afterwards ("edit"). Either way the whole set of planning
 * fields is saved and the enquiry is (or stays) flagged. Only the enquiry's owner or a Sales founder is offered it; the database checks again.
 */
export function OpsPlanningButton({ mode, opportunityId, version, values, won = false }: Target & { mode: "flag" | "edit"; values: OpsPlanningValues; won?: boolean }) {
  const [open, setOpen] = useState(false);
  const label = mode === "flag" ? "Flag for Operations planning" : "Edit planning details";
  const close = () => setOpen(false);
  return (
    <>
      <Button type="button" size="sm" variant={mode === "flag" ? "default" : "outline"} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={close} title={label} description={mode === "flag" ? "Operations will see this enquiry in Upcoming Work so they can plan ahead. Nothing is booked, reserved or created by flagging it." : "What Sales tells Operations about this enquiry. Nothing is booked, reserved or created by saving it."}>
        <ActionForm action={setOpsPlanning} submitLabel={mode === "flag" ? "Flag for Operations planning" : "Save planning details"} pendingLabel="Saving…" onDone={close} secondary={<Button type="button" variant="ghost" onClick={close}>Cancel</Button>}>
          <input type="hidden" name="id" value={opportunityId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <Alert role="note">{OPS_READS_FROM_ENQUIRY}</Alert>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Expected decision date" htmlFor="ops-decision-date" hint="When you expect the client to decide.">
              <Input id="ops-decision-date" name="decisionDate" type="date" defaultValue={values.decisionDate ?? ""} />
            </Field>
            <Field label="Dismantling date" htmlFor="ops-dismantle-date">
              <Input id="ops-dismantle-date" name="dismantleDate" type="date" defaultValue={values.dismantleDate ?? ""} />
            </Field>
          </div>
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="datesTentative" className="mt-0.5 h-4 w-4" defaultChecked={values.datesTentative} />
              <span className="font-medium">{OPS_DATES_TENTATIVE}</span>
            </label>
            <p className="text-sm text-muted-foreground">{won ? "This enquiry is won, so Operations sees the dates as confirmed whatever is ticked here." : "Untick this once the client has confirmed the installation, event and dismantling dates."}</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Expected teams</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {OPS_TEAMS.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="teams" value={t} className="h-4 w-4" defaultChecked={values.teams.includes(t)} />
                  {OPS_TEAM_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Still to confirm" htmlFor="ops-to-confirm" hint="What you are still waiting to hear from the client, in plain words.">
            <Textarea id="ops-to-confirm" name="toConfirm" rows={3} maxLength={OPS_TEXT_MAX} defaultValue={values.toConfirm ?? ""} />
          </Field>
          <Field label="Note for Operations" htmlFor="ops-note" hint={OPS_NOTE_HINT}>
            <Textarea id="ops-note" name="note" rows={3} maxLength={OPS_TEXT_MAX} defaultValue={values.note ?? ""} />
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Asks first: Operations stops seeing the enquiry at once. The planning details stay on the enquiry, so flagging it again brings them back. */
export function RemoveOpsPlanningButton({ opportunityId, version }: Target) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Remove from Operations planning</Button>
      <Modal open={open} onClose={close} title="Remove from Operations planning" description="Operations will no longer see this enquiry in Upcoming Work.">
        <ActionForm action={removeOpsPlanning} submitLabel="Remove from Operations planning" pendingLabel="Removing…" variant="destructive" onDone={close} secondary={<Button type="button" variant="ghost" onClick={close}>Cancel</Button>}>
          <input type="hidden" name="id" value={opportunityId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <p className="text-sm">The planning details you entered stay on the enquiry, and what Operations recorded is kept. Flag the enquiry again to show it to Operations again. Nothing was booked, so nothing is released.</p>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Sales' answer to the question Operations asked. `current` is the answer already given, when there is one: posting again replaces it. */
export function OpsAnswerForm({ opportunityId, version, current }: Target & { current: string | null }) {
  return (
    <ActionForm action={answerOpsQuestion} submitLabel={current ? "Replace the answer" : "Send answer to Operations"} pendingLabel="Sending…" resetOnSuccess className="space-y-3">
      <input type="hidden" name="id" value={opportunityId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <Field label={current ? "Change your answer" : "Your answer"} htmlFor="ops-answer" hint="Operations can read this. Do not put prices or commercial terms here.">
        <Textarea id="ops-answer" name="answer" rows={3} required maxLength={OPS_TEXT_MAX} defaultValue={current ?? ""} />
      </Field>
    </ActionForm>
  );
}
