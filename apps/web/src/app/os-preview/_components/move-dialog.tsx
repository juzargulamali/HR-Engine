"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { HOLD_REASONS, TODAY, type Opportunity, type StageId, allowedMoves, stageLabel } from "../_lib/data";
import { PLink } from "./context";
import { Field, Sheet } from "./ui";

export interface MoveResult { stage: StageId; holdReason?: string; holdReview?: string; nextAction?: string; nextDate?: string }

/**
 * Controlled stage change. Won and Lost are deliberately NOT here: they need evidence or a reason and live on the
 * confirmation page. Every open stage needs an owner-set next action and date; on hold needs a reason and review date.
 */
export function MoveDialog({ opp, stage, open, onClose, onMoved }: { opp: Opportunity; stage: StageId; open: boolean; onClose: () => void; onMoved: (r: MoveResult) => void }) {
  const moves = allowedMoves(stage);
  const [target, setTarget] = useState<StageId>(moves[0] ?? stage);
  const [reason, setReason] = useState<string>(HOLD_REASONS[0]);
  const [note, setNote] = useState("");
  const [review, setReview] = useState("");
  const [action, setAction] = useState("");
  const [date, setDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (target === "on_hold") {
      if (reason.startsWith("Other") && !note.trim()) err.note = "Add a short note explaining why.";
      if (!review) err.review = "Choose a date to review this hold.";
      else if (review <= TODAY) err.review = "The review date must be after today (19 Oct 2026 in this preview).";
    } else {
      if (!action.trim()) err.action = "Every open opportunity needs a next action.";
      if (!date) err.date = "Choose a date for the next action.";
    }
    setErrors(err);
    if (Object.keys(err).length) return;
    onMoved(target === "on_hold" ? { stage: target, holdReason: reason.startsWith("Other") ? `Other: ${note.trim()}` : reason, holdReview: review } : { stage: target, nextAction: action.trim(), nextDate: date });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Change stage: ${opp.ref}`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-muted-foreground">Currently <strong className="text-foreground">{stageLabel(stage)}</strong>. Only the moves allowed from this stage are listed.</p>
        <Field label="Move to" htmlFor="mv-target" required>
          <Select id="mv-target" value={target} onChange={(e) => setTarget(e.target.value as StageId)}>
            {moves.map((m) => <option key={m} value={m}>{stageLabel(m)}</option>)}
          </Select>
        </Field>
        {target === "on_hold" ? (
          <>
            <Field label="Reason for hold" htmlFor="mv-reason" required>
              <Select id="mv-reason" value={reason} onChange={(e) => setReason(e.target.value)}>{HOLD_REASONS.map((r) => <option key={r}>{r}</option>)}</Select>
            </Field>
            {reason.startsWith("Other") ? <Field label="Note" htmlFor="mv-note" required error={errors.note}><Textarea id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field> : null}
            <Field label="Review date" htmlFor="mv-review" required error={errors.review} hint="You will be reminded to review this hold on this date."><Input id="mv-review" type="date" value={review} onChange={(e) => setReview(e.target.value)} /></Field>
          </>
        ) : (
          <>
            <Field label="Next action" htmlFor="mv-action" required error={errors.action} hint="For example: Call to confirm dates."><Input id="mv-action" value={action} onChange={(e) => setAction(e.target.value)} /></Field>
            <Field label="Next action date" htmlFor="mv-date" required error={errors.date}><Input id="mv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </>
        )}
        <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          Winning or losing is not a normal move: it needs evidence or a reason.{" "}
          <PLink href={`/os-preview/sales/opportunities/${opp.ref}/close`} className="font-medium text-[hsl(var(--os-link))] hover:underline">Open the Won / Lost confirmation</PLink>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Cancel</button>
          <Button type="submit" size="sm">Change stage</Button>
        </div>
      </form>
    </Sheet>
  );
}
