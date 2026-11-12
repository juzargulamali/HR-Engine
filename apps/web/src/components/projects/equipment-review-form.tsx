"use client";

import { Input } from "@/components/ui/input";
import { InvForm } from "@/components/inventory/planning/inv-form";
import { resolveEquipmentReview } from "@/lib/actions/projectsEquipmentReview";

/** "Mark as reviewed" on one review of an equipment booking, with an optional note. It records that someone looked: the booking itself is changed by the warehouse on the request. */
export function EquipmentReviewForm({ reviewId, projectId }: { reviewId: string; projectId: string }) {
  return (
    <InvForm action={resolveEquipmentReview} submitLabel="Mark as reviewed" pendingLabel="Saving…" variant="outline" className="space-y-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="projectId" value={projectId} />
      <div className="space-y-1">
        <label htmlFor={`review-note-${reviewId}`} className="text-[13px] text-muted-foreground">Note (optional)</label>
        <Input id={`review-note-${reviewId}`} name="note" maxLength={500} placeholder="What was decided, for example: the warehouse moved the booking" />
      </div>
    </InvForm>
  );
}
