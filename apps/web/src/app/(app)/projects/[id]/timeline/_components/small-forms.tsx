"use client";

import { applyTimelineTemplate, cancelSiteBooking, confirmSiteBooking, deleteExternalDependency, deletePlanItem } from "@/lib/actions/projectsPlans";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { DialogActionForm, DialogButton } from "./dialog";

/** Apply the suggested timeline once to an empty plan. Every item can be edited or removed afterwards. */
export function TemplateForm({ projectId, plan, defaultBase, label }: { projectId: string; plan: "delivery" | "site"; defaultBase: string; label: string }) {
  return (
    <ActionForm action={applyTimelineTemplate} submitLabel={label} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="plan" value={plan} />
      <Field label={plan === "delivery" ? "First day of work (optional)" : "First site day (optional)"} htmlFor={`tpl-${plan}`} hint="With a date, each suggested stage gets a date counted from it; without one the stages are created unscheduled. Either way you can change every item.">
        <Input id={`tpl-${plan}`} name="baseDate" type="date" defaultValue={defaultBase} />
      </Field>
    </ActionForm>
  );
}

export function DeletePlanItemButton({ projectId, itemId, title }: { projectId: string; itemId: string; title: string }) {
  return (
    <DialogButton label="Delete" title={`Delete “${title}”?`} description="It is removed from this timeline and from any client timeline you issue later. Timelines already issued are not changed." variant="ghost">
      <DialogActionForm action={deletePlanItem} submitLabel="Delete item" variant="destructive">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="itemId" value={itemId} />
      </DialogActionForm>
    </DialogButton>
  );
}

export function DeleteDependencyButton({ projectId, dependencyId, label }: { projectId: string; dependencyId: string; label: string }) {
  return (
    <DialogButton label="Delete" title={`Delete “${label}”?`} description="Timelines already issued are not changed." variant="ghost">
      <DialogActionForm action={deleteExternalDependency} submitLabel="Delete dependency" variant="destructive">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="dependencyId" value={dependencyId} />
      </DialogActionForm>
    </DialogButton>
  );
}

export function CancelBookingButton({ projectId, bookingId }: { projectId: string; bookingId: string }) {
  return (
    <DialogButton label="Cancel booking" title="Cancel this booking?" description="The person is told. The booking stays in the history." variant="ghost">
      <DialogActionForm action={cancelSiteBooking} submitLabel="Cancel booking" variant="destructive">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="bookingId" value={bookingId} />
        <Field label="Reason (optional)" htmlFor={`cb-${bookingId}`}><Input id={`cb-${bookingId}`} name="reason" /></Field>
      </DialogActionForm>
    </DialogButton>
  );
}

/** Confirm a tentative booking. If it overlaps another confirmed booking the database refuses in words; an authorised person may then confirm with a reason. */
export function ConfirmBookingForms({ projectId, bookingId, canOverride }: { projectId: string; bookingId: string; canOverride: boolean }) {
  return (
    <div className="space-y-2">
      <ActionForm action={confirmSiteBooking} submitLabel="Confirm booking" className="space-y-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="bookingId" value={bookingId} />
      </ActionForm>
      {canOverride ? (
        <details className="rounded-md border border-border p-2 text-sm">
          <summary className="cursor-pointer font-medium">Confirm even if it overlaps (needs a reason)</summary>
          <ActionForm action={confirmSiteBooking} submitLabel="Confirm despite the overlap" variant="outline" className="mt-2 space-y-2">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="bookingId" value={bookingId} />
            <Field label="Why this is acceptable" htmlFor={`ov-${bookingId}`} hint="Recorded with your name against the booking, and shown in its history.">
              <Input id={`ov-${bookingId}`} name="overrideReason" required />
            </Field>
          </ActionForm>
        </details>
      ) : (
        <p className="text-sm text-muted-foreground">If it overlaps another confirmed booking, change the time or the person. Only a founder, or someone a founder gave site-conflict authority to, can confirm an overlap.</p>
      )}
    </div>
  );
}
