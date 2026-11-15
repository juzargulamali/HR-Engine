"use client";

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/sales/modal";
import { AddActivityForm, type OpenFollowUp } from "./add-activity-form";

export interface LogActivityProps { opportunityId: string; completable: OpenFollowUp[]; suggestedDate: string; minDate: string; /** The Sales time zone of the enquiry's company. */ timeZone: string }

/** The Log activity form as a dialog (controlled), so it can be opened from the summary's main button, a menu or a row without changing tab. */
export function LogActivityDialog({ open, onClose, ...p }: LogActivityProps & { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Log activity" description="What happened, and the next step, in one go."
      help="Records a call, email, meeting, note or client response on this enquiry's timeline. Choose Client response only when the client actually replied. A proposal is recorded under Proposals & files and a quote reference under Commercial: they are different records, not a kind of note.">
      <AddActivityForm opportunityId={p.opportunityId} onDone={onClose} completable={p.completable} suggestedDate={p.suggestedDate} minDate={p.minDate} timeZone={p.timeZone} />
    </Modal>
  );
}

/** "Log activity": the same words and the same form wherever it appears on the enquiry. */
export function LogActivityButton({ variant = "outline", label = "Log activity", ...p }: LogActivityProps & { variant?: "outline" | "default" | "ghost"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant={variant} onClick={() => setOpen(true)}><MessageSquarePlus className="h-4 w-4" aria-hidden /> {label}</Button>
      <LogActivityDialog open={open} onClose={() => setOpen(false)} {...p} />
    </>
  );
}
