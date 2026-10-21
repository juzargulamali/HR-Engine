"use client";

import { useState } from "react";
import { MoreMenu, type MoreItem } from "@/components/workspace/more-menu";
import { AssignOwnerDialog, type AssignOwnerProps } from "../opportunities/[id]/assign-owner";
import { EditDetailsDialog, type EditDetailsProps } from "../opportunities/[id]/edit-details";
import { ReopenDialog, type ReopenProps } from "../opportunities/[id]/reopen-dialog";
import { CloseDialog, HoldDialog, MoveStageDialog, ResumeDialog, type MoveOption } from "../opportunities/[id]/stage-actions";

/** Everything the "More" menu of one enquiry needs, as plain data (decided on the server from the same rules as the full page). */
export interface EnquiryActionsProps {
  opportunityId: string;
  version: number;
  stage: string;
  moveOptions: MoveOption[] | null;
  canHold: boolean;
  resume: { returnsTo: string | null } | null;
  close: { won: boolean; lost: boolean; valueText: string; hasValue: boolean; openFollowUps: number; onHold: boolean } | null;
  assign: Omit<AssignOwnerProps, "opportunityId"> | null;
  reopen: Omit<ReopenProps, "opportunityId" | "version"> | null;
  edit: Omit<EditDetailsProps, never> | null;
  handoverHref: string | null;
}

type DialogId = "move" | "hold" | "resume" | "won" | "lost" | "assign" | "reopen" | "edit";

/**
 * The infrequent actions of an enquiry, under one "More" button, each opening its normal confirmation form as a dialog. Nothing here
 * changes data by itself, and every form is the same one the full page uses (Hold still needs a reason and a review date, Won still
 * needs evidence and a value, Lost a reason, Reopen is restricted and recorded).
 */
export function EnquiryActions(p: EnquiryActionsProps) {
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const items: MoreItem[] = [];
  if (p.edit) items.push({ key: "edit", label: p.edit.mode === "value" ? "Edit value" : "Edit details" });
  if (p.moveOptions && p.moveOptions.length > 0) items.push({ key: "move", label: "Move to another stage" });
  if (p.canHold) items.push({ key: "hold", label: "Put on hold", hint: "Needs a reason and a review date" });
  if (p.resume) items.push({ key: "resume", label: "Resume", hint: "Needs a next action" });
  if (p.assign) items.push({ key: "assign", label: "Reassign owner" });
  if (p.handoverHref) items.push({ key: "handover", label: "Handover package", href: p.handoverHref, separatorBefore: true });
  if (p.close?.won) items.push({ key: "won", label: "Close as won", hint: "Needs evidence and a value", separatorBefore: true });
  if (p.close?.lost) items.push({ key: "lost", label: "Close as lost", hint: "Needs a reason", danger: true, separatorBefore: !p.close.won });
  if (p.reopen) items.push({ key: "reopen", label: "Reopen", hint: "Founders only; the closure stays in the history", separatorBefore: true });
  const close = () => setDialog(null);
  const select = (key: string) => setDialog(key as DialogId);
  const wired = items.map((i) => (i.href ? i : { ...i, onSelect: select }));
  return (
    <>
      <MoreMenu items={wired} label="More actions" />
      {p.edit ? <EditDetailsDialog open={dialog === "edit"} onClose={close} {...p.edit} /> : null}
      {p.moveOptions && p.moveOptions.length > 0 ? <MoveStageDialog open={dialog === "move"} onClose={close} opportunityId={p.opportunityId} version={p.version} stage={p.stage} options={p.moveOptions} /> : null}
      {p.canHold ? <HoldDialog open={dialog === "hold"} onClose={close} opportunityId={p.opportunityId} version={p.version} /> : null}
      {p.resume ? <ResumeDialog open={dialog === "resume"} onClose={close} opportunityId={p.opportunityId} version={p.version} returnsTo={p.resume.returnsTo} /> : null}
      {p.assign ? <AssignOwnerDialog open={dialog === "assign"} onClose={close} opportunityId={p.opportunityId} {...p.assign} /> : null}
      {p.close ? (
        <CloseDialog
          open={dialog === "won" || dialog === "lost"}
          onClose={close}
          opportunityId={p.opportunityId}
          version={p.version}
          initialOutcome={dialog === "lost" ? "lost" : "won"}
          onHold={p.close.onHold}
          valueText={p.close.valueText}
          hasValue={p.close.hasValue}
          openFollowUps={p.close.openFollowUps}
        />
      ) : null}
      {p.reopen ? <ReopenDialog open={dialog === "reopen"} onClose={close} opportunityId={p.opportunityId} version={p.version} {...p.reopen} /> : null}
    </>
  );
}
