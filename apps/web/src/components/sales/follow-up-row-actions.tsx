"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoreMenu, type MoreItem } from "@/components/workspace/more-menu";
import { CancelFollowUpDialog, CompleteFollowUpDialog, RescheduleFollowUpDialog, type FollowUpRef } from "./follow-up-dialogs";

/**
 * What can be done to one follow-up in a list: Complete follow-up (the main action) and, under More, Reschedule and Cancel. The same
 * dialogs and rules as on the enquiry itself: completing the last open follow-up of an active enquiry asks what happens next, and that
 * one cannot be cancelled.
 */
export function FollowUpRowActions({ followUp }: { followUp: FollowUpRef }) {
  const [dialog, setDialog] = useState<"complete" | "reschedule" | "cancel" | null>(null);
  const items: MoreItem[] = [
    { key: "reschedule", label: "Reschedule", onSelect: () => setDialog("reschedule") },
    ...(followUp.isOnlyOpen ? [] : [{ key: "cancel", label: "Cancel follow-up", danger: true, onSelect: () => setDialog("cancel") }]),
  ];
  const close = () => setDialog(null);
  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" size="sm" variant="outline" aria-label={`Complete follow-up: ${followUp.title}`} onClick={() => setDialog("complete")}>
        <CheckCircle2 className="h-4 w-4" aria-hidden /> Complete
      </Button>
      <MoreMenu items={items} label="More" variant="ghost" />
      <CompleteFollowUpDialog open={dialog === "complete"} onClose={close} followUp={followUp} />
      <RescheduleFollowUpDialog open={dialog === "reschedule"} onClose={close} followUp={followUp} />
      <CancelFollowUpDialog open={dialog === "cancel"} onClose={close} followUp={followUp} />
    </div>
  );
}
