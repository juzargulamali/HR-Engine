"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CRM_HOLD_REASONS, crmStageLabel } from "@enginious-hr/domain";
import { holdOpportunity, moveStage, resumeOpportunity } from "@/lib/actions/crm";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { todayInDubai } from "@/components/sales/format";
import { composeReason, OTHER_HOLD_REASON } from "./helpers";

export interface MoveOption {
  id: string;
  label: string;
  /** Set when the database would refuse this move for now; says what to do first. */
  requirement: string | null;
}

const KINDS = [["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["proposal", "Proposal work"], ["other", "Other"]] as const;

/** Controlled stage change: only the moves the database allows from this stage. Won, Lost and Hold are separate actions. */
export function MoveStageButton({ opportunityId, version, stage, options }: { opportunityId: string; version: number; stage: string; options: MoveOption[] }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(options[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The stage (and so the list of moves) changes after a successful move; never keep pointing at a move that no longer exists.
  const effective = options.some((o) => o.id === target) ? target : (options[0]?.id ?? "");
  const chosen = options.find((o) => o.id === effective);
  if (options.length === 0) return null;
  return (
    <>
      <Button type="button" size="sm" onClick={() => { setError(null); setOpen(true); }}>Move stage</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Move to another stage" description={`Currently ${crmStageLabel(stage)}. You can go back one step or forward to any later stage.`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!chosen || chosen.requirement) return;
            setError(null);
            start(async () => {
              const r = await moveStage(opportunityId, chosen.id, version);
              if (r.error) setError(r.error);
              else setOpen(false);
            });
          }}
        >
          <Field label="Move to" htmlFor="move-target">
            <Select id="move-target" value={effective} onChange={(e) => setTarget(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </Field>
          {chosen?.requirement ? <Alert variant="warning">{chosen.requirement}</Alert> : null}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <p className="text-xs text-muted-foreground">
            Winning or losing needs evidence or a reason: use <Link href={`/sales/opportunities/${opportunityId}/close?outcome=won`} className="font-medium underline">Close as won</Link> or{" "}
            <Link href={`/sales/opportunities/${opportunityId}/close?outcome=lost`} className="font-medium underline">Close as lost</Link>. To pause it, use Put on hold.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !chosen || !!chosen.requirement}>{pending ? "Moving…" : "Move stage"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function HoldButton({ opportunityId, version }: { opportunityId: string; version: number }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(CRM_HOLD_REASONS[0]);
  const [note, setNote] = useState("");
  const isOther = choice === OTHER_HOLD_REASON;
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => { setChoice(CRM_HOLD_REASONS[0]); setNote(""); setOpen(true); }}>Put on hold</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Put on hold" description="Use this when the enquiry is paused for a reason. It keeps its owner and earlier stage, you are reminded on the review date, and you can resume it at any time.">
        <ActionForm action={holdOpportunity} submitLabel="Put on hold" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="id" value={opportunityId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <input type="hidden" name="reason" value={composeReason(choice, note, OTHER_HOLD_REASON)} />
          <Field label="Reason" htmlFor="hold-reason">
            <Select id="hold-reason" value={choice} onChange={(e) => setChoice(e.target.value)}>
              {CRM_HOLD_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label={isOther ? "Note (required)" : "Note (optional)"} htmlFor="hold-note">
            <Textarea id="hold-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} required={isOther} />
          </Field>
          <Field label="Review date" htmlFor="hold-review" hint="Today or later. You will be reminded to review it on this date.">
            <Input id="hold-review" name="reviewDate" type="date" required min={todayInDubai()} />
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

export function ResumeButton({ opportunityId, version, returnsTo }: { opportunityId: string; version: number; returnsTo: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>Resume</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Resume this opportunity" description={`It goes back to ${returnsTo ? crmStageLabel(returnsTo) : "its earlier stage"}. An active opportunity always needs a next action.`}>
        <ActionForm action={resumeOpportunity} submitLabel="Resume" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="id" value={opportunityId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <Field label="Next action" htmlFor="resume-title"><Input id="resume-title" name="nextTitle" required placeholder="e.g. Call to confirm the new dates" /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date" htmlFor="resume-date"><Input id="resume-date" name="nextDate" type="date" required min={todayInDubai()} /></Field>
            <Field label="Time (Dubai)" htmlFor="resume-time"><Input id="resume-time" name="nextTime" type="time" defaultValue="10:00" /></Field>
            <Field label="Type" htmlFor="resume-kind">
              <Select id="resume-kind" name="nextKind" defaultValue="call">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            </Field>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
