"use client";

import { useState } from "react";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoreMenu, type MoreItem } from "@/components/workspace/more-menu";
import { CancelFollowUpDialog, CompleteFollowUpDialog, RescheduleFollowUpDialog, type FollowUpRef } from "./follow-up-dialogs";

/**
 * What can be done to one follow-up in a list: Complete (the main action, which also records the outcome and plans the next action), Reschedule one tap
 * away beside it, and Cancel under More. The same dialogs and rules as on the enquiry itself: completing the last open follow-up of an active enquiry asks
 * what happens next, and that one cannot be cancelled. The Cancel item then stays in the menu, switched off, with the reason, because it is a blocker
 * the person should be able to read rather than a missing button.
 */
export function FollowUpRowActions({ followUp }: { followUp: FollowUpRef }) {
  const [dialog, setDialog] = useState<"complete" | "reschedule" | "cancel" | null>(null);
  const items: MoreItem[] = [
    followUp.isOnlyOpen
      ? { key: "cancel", label: "Cancel follow-up", disabled: true, hint: "This is the enquiry's only next action. Complete it with a new next action, or put the enquiry on hold." }
      : { key: "cancel", label: "Cancel follow-up", danger: true, onSelect: () => setDialog("cancel") },
  ];
  const close = () => setDialog(null);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button type="button" size="sm" aria-label={`Complete follow-up: ${followUp.title}`} onClick={() => setDialog("complete")}>
        <CheckCircle2 className="h-4 w-4" aria-hidden /> Complete
      </Button>
      <Button type="button" size="sm" variant="outline" aria-label={`Reschedule follow-up: ${followUp.title}`} onClick={() => setDialog("reschedule")}>
        <CalendarClock className="h-4 w-4" aria-hidden /> Reschedule
      </Button>
      <MoreMenu items={items} label="More" variant="ghost" />
      <CompleteFollowUpDialog open={dialog === "complete"} onClose={close} followUp={followUp} />
      <RescheduleFollowUpDialog open={dialog === "reschedule"} onClose={close} followUp={followUp} />
      <CancelFollowUpDialog open={dialog === "cancel"} onClose={close} followUp={followUp} />
    </div>
  );
}
