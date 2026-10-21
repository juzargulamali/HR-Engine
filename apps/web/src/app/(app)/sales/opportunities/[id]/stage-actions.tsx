"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CRM_EVIDENCE_TYPES, CRM_HOLD_REASONS, CRM_LOST_REASONS, crmStageLabel } from "@enginious-hr/domain";
import { holdOpportunity, markLost, markWon, moveStage, resumeOpportunity } from "@/lib/actions/crm";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { todayInDubai } from "@/components/sales/format";
import { composeReason, OTHER_HOLD_REASON, OTHER_LOST_REASON } from "./helpers";

export interface MoveOption {
  id: string;
  label: string;
  /** Set when the database would refuse this move for now; says what to do first. */
  requirement: string | null;
}

const KINDS = [["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["proposal", "Proposal work"], ["other", "Other"]] as const;

export interface MoveStageProps { opportunityId: string; version: number; stage: string; options: MoveOption[] }

/** Controlled stage change: only the moves the database allows from this stage. Won, Lost and Hold are separate actions. */
export function MoveStageDialog({ open, onClose, opportunityId, version, stage, options }: MoveStageProps & { open: boolean; onClose: () => void }) {
  const [target, setTarget] = useState(options[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The stage (and so the list of moves) changes after a successful move; never keep pointing at a move that no longer exists.
  const effective = options.some((o) => o.id === target) ? target : (options[0]?.id ?? "");
  const chosen = options.find((o) => o.id === effective);
  return (
    <Modal open={open} onClose={onClose} title="Move to another stage" description={`Currently ${crmStageLabel(stage)}. You can go back one step or forward to any later stage.`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!chosen || chosen.requirement) return;
          setError(null);
          start(async () => {
            const r = await moveStage(opportunityId, chosen.id, version);
            if (r.error) setError(r.error);
            else onClose();
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
        <p className="text-sm text-muted-foreground">
          Winning or losing needs evidence or a reason: use <Link href={`/sales/opportunities/${opportunityId}/close?outcome=won`} className="font-medium underline">Close as won</Link> or{" "}
          <Link href={`/sales/opportunities/${opportunityId}/close?outcome=lost`} className="font-medium underline">Close as lost</Link>. To pause it, use Put on hold.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={pending || !chosen || !!chosen.requirement}>{pending ? "Moving…" : "Move stage"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function MoveStageButton(p: MoveStageProps) {
  const [open, setOpen] = useState(false);
  if (p.options.length === 0) return null;
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>Move stage</Button>
      <MoveStageDialog open={open} onClose={() => setOpen(false)} {...p} />
    </>
  );
}

export interface HoldProps { opportunityId: string; version: number }

function HoldBody({ opportunityId, version, onClose }: HoldProps & { onClose: () => void }) {
  const [choice, setChoice] = useState<string>(CRM_HOLD_REASONS[0]);
  const [note, setNote] = useState("");
  const isOther = choice === OTHER_HOLD_REASON;
  return (
    <ActionForm action={holdOpportunity} submitLabel="Put on hold" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
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
  );
}

/** Controlled dialog: Hold still needs its reason and a review date, exactly as before. */
export function HoldDialog({ open, onClose, ...p }: HoldProps & { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Put on hold" description="Use this when the enquiry is paused for a reason. It keeps its owner and earlier stage, you are reminded on the review date, and you can resume it at any time.">
      <HoldBody {...p} onClose={onClose} />
    </Modal>
  );
}

export function HoldButton(p: HoldProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Put on hold</Button>
      <HoldDialog open={open} onClose={() => setOpen(false)} {...p} />
    </>
  );
}

export interface ResumeProps { opportunityId: string; version: number; returnsTo: string | null }

/** Controlled dialog. Resuming still needs the next action. */
export function ResumeDialog({ open, onClose, opportunityId, version, returnsTo }: ResumeProps & { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Resume this opportunity" description={`It goes back to ${returnsTo ? crmStageLabel(returnsTo) : "its earlier stage"}. An active opportunity always needs a next action.`}>
      <ActionForm action={resumeOpportunity} submitLabel="Resume" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
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
  );
}

export function ResumeButton(p: ResumeProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>Resume</Button>
      <ResumeDialog open={open} onClose={() => setOpen(false)} {...p} />
    </>
  );
}

export interface CloseProps {
  opportunityId: string;
  version: number;
  initialOutcome: "won" | "lost";
  /** On hold: it can be marked Lost but not Won until resumed (the database refuses Won). */
  onHold: boolean;
  valueText: string;
  hasValue: boolean;
  openFollowUps: number;
}

function CloseBody({ opportunityId, version, initialOutcome, onHold, valueText, hasValue, openFollowUps, onClose }: CloseProps & { onClose: () => void }) {
  const [outcome, setOutcome] = useState<"won" | "lost">(onHold ? "lost" : initialOutcome);
  const [evidenceType, setEvidenceType] = useState<string>(CRM_EVIDENCE_TYPES[0]?.id ?? "purchase_order");
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const lostReason = choice === "" ? "" : composeReason(choice, note, OTHER_LOST_REASON);
  const cancel = <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>;
  const followUpText = openFollowUps === 0 ? "There are no open follow-ups to cancel." : `${openFollowUps} open follow-up${openFollowUps === 1 ? " is" : "s are"} cancelled.`;
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">Outcome</legend>
        <div className="flex flex-wrap gap-2">
          {(["won", "lost"] as const).map((o) => {
            const disabled = o === "won" && onHold;
            return (
              <label key={o} className={`flex min-w-[8rem] items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${outcome === o ? "border-accent bg-accent/10" : "border-border"}`}>
                <input type="radio" name="close-outcome" value={o} checked={outcome === o} disabled={disabled} onChange={() => setOutcome(o)} />
                {o === "won" ? "Won" : "Lost"}
              </label>
            );
          })}
        </div>
        {onHold ? <p className="mt-1.5 text-sm text-muted-foreground">This opportunity is on hold. Resume it first if it has been won; it can be marked Lost directly.</p> : null}
      </fieldset>

      {outcome === "won" ? (
        <>
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="text-sm text-muted-foreground">Confirmed value</p>
            <p className="font-medium">{valueText}</p>
            {!hasValue ? (
              <Alert className="mt-2" variant="warning">
                The value must be set before it can be marked Won. <Link href={`/sales/opportunities/${opportunityId}?tab=scope`} className="font-medium underline">Open the full page and use Edit details</Link>, then come back.
              </Alert>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">Winning needs a purchase order or an authorised email. A sent or accepted proposal, or an equipment check, is not enough. It becomes read-only apart from the handover, files, proposal acceptance and (for founders) the value. {followUpText}</p>
          <ActionForm action={markWon} submitLabel="Confirm as won" pendingLabel="Saving…" onDone={onClose} secondary={cancel}>
            <input type="hidden" name="id" value={opportunityId} />
            <input type="hidden" name="expectedVersion" value={version} />
            <input type="hidden" name="after" value="stay" />
            <Field label="Type of confirmation" htmlFor="cw-type">
              <Select id="cw-type" name="evidenceType" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
                {CRM_EVIDENCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label={evidenceType === "purchase_order" ? "PO number" : "Email reference (sender and subject)"} htmlFor="cw-ref"><Input id="cw-ref" name="evidenceReference" required /></Field>
            <Field label="Date on the document" htmlFor="cw-date" hint="Not in the future."><Input id="cw-date" name="evidenceDate" type="date" required max={todayInDubai()} /></Field>
            <Field label="Note (optional)" htmlFor="cw-note"><Textarea id="cw-note" name="note" rows={2} /></Field>
            {!hasValue ? <Alert variant="destructive">Set the value first: the database will not record a win without one.</Alert> : null}
          </ActionForm>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">The opportunity becomes read-only and the reason is kept for reporting. {followUpText}</p>
          <ActionForm action={markLost} submitLabel="Confirm as lost" pendingLabel="Saving…" variant="destructive" onDone={onClose} secondary={cancel}>
            <input type="hidden" name="id" value={opportunityId} />
            <input type="hidden" name="expectedVersion" value={version} />
            <input type="hidden" name="after" value="stay" />
            <input type="hidden" name="reason" value={lostReason} />
            <Field label="Reason" htmlFor="cl-reason">
              <Select id="cl-reason" value={choice} onChange={(e) => setChoice(e.target.value)} required>
                <option value="">Choose a reason…</option>
                {CRM_LOST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                <option value={OTHER_LOST_REASON}>{OTHER_LOST_REASON}</option>
              </Select>
            </Field>
            <Field label={choice === OTHER_LOST_REASON ? "Reason in your own words (required)" : "Note (optional)"} htmlFor="cl-note">
              <Textarea id="cl-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} required={choice === OTHER_LOST_REASON} />
            </Field>
          </ActionForm>
        </>
      )}
    </div>
  );
}

/**
 * Won and Lost in a dialog, for the enquiry panel and the board. Same rules as the full close page: Won needs evidence and a value,
 * Lost needs a reason; both are checked again by the database. The full page (/close) stays available for the long explanation.
 */
export function CloseDialog({ open, onClose, ...p }: CloseProps & { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Close this opportunity" description="Won needs evidence of the win; Lost needs a reason. Both are kept in the history." size="wide">
      <CloseBody {...p} onClose={onClose} />
    </Modal>
  );
}
