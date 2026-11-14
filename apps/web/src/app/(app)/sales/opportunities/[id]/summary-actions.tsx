"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, MessageSquarePlus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { CompleteFollowUpDialog, NewFollowUpButton, RescheduleFollowUpDialog, type FollowUpRef } from "@/components/sales/follow-up-dialogs";
import { MoreMenu, type MoreItem } from "@/components/workspace/more-menu";
import { cn } from "@/lib/utils";
import { AssignOwnerDialog, type AssignOwnerProps } from "./assign-owner";
import { TabLink } from "./detail-tabs";
import { EditDetailsDialog, type EditDetailsProps } from "./edit-details";
import { LogActivityDialog, type LogActivityProps } from "./log-activity-button";
import type { PrimaryAction } from "./primary-action";
import { ReopenDialog, type ReopenProps } from "./reopen-dialog";
import { HoldDialog, MoveStageDialog, ResumeDialog, type MoveOption } from "./stage-actions";

/** Everything the summary's buttons need, as plain data decided on the server from the same permission view as the tabs (view.ts). Null = not offered to this person now. */
export interface SummaryActionsProps {
  opportunityId: string;
  version: number;
  stage: string;
  primary: PrimaryAction | null;
  /** The next follow-up, when this person may complete or reschedule it. */
  followUp: FollowUpRef | null;
  newFollowUp: { people: { id: string; name: string }[]; canAssign: boolean; currentUserId: string } | null;
  log: Omit<LogActivityProps, "opportunityId"> | null;
  /** The stage moves, or why they are not offered right now. */
  move: { options: MoveOption[] } | { unavailable: string } | null;
  canHold: boolean;
  resume: { returnsTo: string | null } | null;
  close: { won: boolean; lost: boolean } | null;
  edit: EditDetailsProps | null;
  assign: Omit<AssignOwnerProps, "opportunityId"> | null;
  reopen: Omit<ReopenProps, "opportunityId" | "version"> | { unavailable: string } | null;
  handoverHref: string | null;
}

type DialogId = "complete" | "reschedule" | "log" | "move" | "hold" | "resume" | "edit" | "assign" | "reopen";
const PRIMARY = cn(buttonVariants({ size: "sm" }));

/**
 * The enquiry's actions in one place: ONE main button for the current next action (primary-action.ts decides which), Log activity beside it, and everything
 * else under "More" in an order that never changes: the follow-up, then Edit, Assign, stage moves, Hold or Resume, Close, Reopen, Handover. Nothing was
 * removed from the old row of buttons, and nothing here changes data by itself: each item opens the same form as before, with the same checks.
 */
export function SummaryActions(p: SummaryActionsProps) {
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const close = () => setDialog(null);
  const base = `/sales/opportunities/${p.opportunityId}`;
  const kind = p.primary?.kind ?? null;
  const moveOptions = p.move && "options" in p.move ? p.move.options : null;
  // "Move to <stage>" opens the usual stage form with that stage already chosen.
  const orderedMoves = moveOptions && p.primary?.stage ? [...moveOptions].sort((a, b) => Number(b.id === p.primary!.stage) - Number(a.id === p.primary!.stage)) : moveOptions;
  const reopen = p.reopen && "outcome" in p.reopen ? p.reopen : null;

  let main: React.ReactNode = null;
  if (p.primary) {
    const label = p.primary.label;
    if (kind === "complete_follow_up" && p.followUp) main = <Button type="button" size="sm" aria-label={`${label}: ${p.followUp.title}`} onClick={() => setDialog("complete")}><CheckCircle2 className="h-4 w-4" aria-hidden /> {label}</Button>;
    // The shared Add follow-up dialog, shown as the main button here (its own button is an outline one).
    else if (kind === "add_next_action" && p.newFollowUp) main = <span className="[&>button]:border-transparent [&>button]:text-primary-foreground [&>button]:[background-image:linear-gradient(135deg,hsl(var(--brand-deep))_0%,hsl(var(--brand-glow))_100%)] [&>button:hover]:brightness-110"><NewFollowUpButton opportunityId={p.opportunityId} {...p.newFollowUp} label={label} /></span>;
    else if (kind === "resume" && p.resume) main = <Button type="button" size="sm" onClick={() => setDialog("resume")}>{label}</Button>;
    else if (kind === "move_stage" && orderedMoves) main = <Button type="button" size="sm" onClick={() => setDialog("move")}>{label}</Button>;
    else if ((kind === "log_first_response" || kind === "log_activity") && p.log) main = <Button type="button" size="sm" onClick={() => setDialog("log")}><MessageSquarePlus className="h-4 w-4" aria-hidden /> {label}</Button>;
    else if (p.primary.href) main = <Link href={p.primary.href} className={PRIMARY}>{label}</Link>;
    else if (p.primary.tab) main = <TabLink tab={p.primary.tab} href={`${base}?tab=${p.primary.tab}`} className={PRIMARY}>{label}</TabLink>;
  }
  const logIsMain = kind === "log_first_response" || kind === "log_activity";

  const items: MoreItem[] = [];
  const on = (id: DialogId) => () => setDialog(id);
  if (p.followUp && kind !== "complete_follow_up") items.push({ key: "complete", label: "Complete follow-up", hint: p.followUp.title, onSelect: on("complete") });
  if (p.followUp) items.push({ key: "reschedule", label: "Reschedule follow-up", hint: kind === "complete_follow_up" ? p.followUp.title : undefined, onSelect: on("reschedule") });
  if (p.edit) items.push({ key: "edit", label: p.edit.mode === "value" ? "Edit value" : "Edit details", onSelect: on("edit"), separatorBefore: items.length > 0 });
  if (p.assign) items.push({ key: "assign", label: "Assign owner", onSelect: on("assign") });
  if (p.move && "unavailable" in p.move) items.push({ key: "move", label: "Move to another stage", hint: p.move.unavailable, disabled: true });
  else if (moveOptions && moveOptions.length > 0) items.push({ key: "move", label: "Move to another stage", onSelect: on("move") });
  if (p.canHold) items.push({ key: "hold", label: "Put on hold", hint: "Needs a reason and a review date", onSelect: on("hold") });
  if (p.resume && kind !== "resume") items.push({ key: "resume", label: "Resume", hint: "Needs a next action", onSelect: on("resume") });
  if (p.close?.won) items.push({ key: "won", label: "Close as won", hint: "Needs a purchase order or an authorised email, and a value", href: `${base}/close?outcome=won`, separatorBefore: true });
  if (p.close?.lost) items.push({ key: "lost", label: "Close as lost", hint: "Needs a reason", href: `${base}/close?outcome=lost`, danger: true, separatorBefore: !p.close.won });
  if (p.reopen && "unavailable" in p.reopen) items.push({ key: "reopen", label: "Reopen", hint: p.reopen.unavailable, disabled: true, separatorBefore: true });
  else if (reopen) items.push({ key: "reopen", label: "Reopen", hint: "The closure stays in the history", onSelect: on("reopen"), separatorBefore: true });
  if (p.handoverHref && kind !== "handover") items.push({ key: "handover", label: "Handover package", href: p.handoverHref, separatorBefore: !p.reopen });

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Enquiry actions">
      {main}
      {p.log && !logIsMain ? <Button type="button" size="sm" variant="outline" onClick={() => setDialog("log")}><MessageSquarePlus className="h-4 w-4" aria-hidden /> Log activity</Button> : null}
      <MoreMenu items={items} label="More" />
      {p.followUp ? <CompleteFollowUpDialog open={dialog === "complete"} onClose={close} followUp={p.followUp} /> : null}
      {p.followUp ? <RescheduleFollowUpDialog open={dialog === "reschedule"} onClose={close} followUp={p.followUp} /> : null}
      {p.log ? <LogActivityDialog open={dialog === "log"} onClose={close} opportunityId={p.opportunityId} {...p.log} /> : null}
      {p.edit ? <EditDetailsDialog open={dialog === "edit"} onClose={close} {...p.edit} /> : null}
      {p.assign ? <AssignOwnerDialog open={dialog === "assign"} onClose={close} opportunityId={p.opportunityId} {...p.assign} /> : null}
      {orderedMoves && orderedMoves.length > 0 ? <MoveStageDialog open={dialog === "move"} onClose={close} opportunityId={p.opportunityId} version={p.version} stage={p.stage} options={orderedMoves} /> : null}
      {p.canHold ? <HoldDialog open={dialog === "hold"} onClose={close} opportunityId={p.opportunityId} version={p.version} /> : null}
      {p.resume ? <ResumeDialog open={dialog === "resume"} onClose={close} opportunityId={p.opportunityId} version={p.version} returnsTo={p.resume.returnsTo} /> : null}
      {reopen ? <ReopenDialog open={dialog === "reopen"} onClose={close} opportunityId={p.opportunityId} version={p.version} {...reopen} /> : null}
    </div>
  );
}
