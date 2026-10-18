"use client";

import { useState } from "react";
import type { StatusMove } from "@enginious-hr/domain";
import { setProjectStatus } from "@/lib/actions/projectsCore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";

/**
 * Change a project's lifecycle state in a small dialog: forward is one click, going back or skipping needs a reason, holding needs
 * a reason and a review date, resuming returns the project to the stage it was held from. Used from the project's Manage menu and
 * when a card is moved on the directory board; either way the database applies exactly the same rules.
 */
export function StatusDialog({ projectId, projectName, moves, currentLabel, initialTo, open, onClose }: { projectId: string; projectName?: string; moves: StatusMove[]; currentLabel: string; initialTo?: string; open: boolean; onClose: () => void }) {
  const [to, setTo] = useState(moves.some((m) => m.to === initialTo) ? (initialTo as string) : (moves[0]?.to ?? ""));
  const move = moves.find((m) => m.to === to) ?? moves[0];
  if (moves.length === 0) return null;
  const resuming = move?.to === "resume";
  return (
    <Modal open={open} onClose={onClose} title="Change status" description={`${projectName ? `${projectName}. ` : ""}Now: ${currentLabel}.${resuming ? " Resuming returns it to the stage it was held from." : ""}`}>
      <ActionForm action={setProjectStatus} submitLabel="Save status" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
        <input type="hidden" name="projectId" value={projectId} />
        <Field label="Move to" htmlFor={`ps-to-${projectId}`}>
          <Select id={`ps-to-${projectId}`} name="to" value={to} onChange={(e) => setTo(e.target.value)}>
            {moves.map((m) => <option key={m.to} value={m.to}>{m.label}</option>)}
          </Select>
        </Field>
        {move?.needsReason ? (
          <Field label={move.needsReviewDate ? "Why is it on hold?" : "Reason"} htmlFor={`ps-reason-${projectId}`} hint={move.needsReviewDate ? undefined : "Moving backwards or skipping a state needs a reason. It is kept in the history."}>
            <Textarea id={`ps-reason-${projectId}`} name="reason" required rows={3} />
          </Field>
        ) : (
          <Field label="Note (optional)" htmlFor={`ps-note-${projectId}`}><Textarea id={`ps-note-${projectId}`} name="reason" rows={2} /></Field>
        )}
        {move?.needsReviewDate ? (
          <Field label="Review date" htmlFor={`ps-review-${projectId}`} hint="When someone will look at this again."><Input id={`ps-review-${projectId}`} name="reviewDate" type="date" required /></Field>
        ) : null}
      </ActionForm>
    </Modal>
  );
}
