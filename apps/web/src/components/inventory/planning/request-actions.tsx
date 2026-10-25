"use client";

import { useState } from "react";
import { cancelRequest, submitRequest } from "@/lib/actions/inventoryPlanning";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MoreMenu } from "@/components/workspace/more-menu";
import { Field, InvForm } from "./inv-form";

/** Send the draft to the warehouse. Says what is missing instead of failing late. Submitting reserves nothing. */
export function SubmitRequest({ requestId, version, projectId, missing }: { requestId: string; version: number; projectId?: string | null; missing: string | null }) {
  if (missing) return <p className="text-sm text-muted-foreground">To submit: {missing}.</p>;
  return (
    <InvForm action={submitRequest} submitLabel="Submit to the warehouse" pendingLabel="Submitting…" className="flex flex-wrap items-center gap-3" >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="expectedVersion" value={version} />
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">The warehouse then reserves from stock. Submitting does not reserve anything by itself.</p>
    </InvForm>
  );
}

/** Cancel the whole request (under More). Anything dispatched already stays outstanding until it is returned, and this says so. */
export function RequestMoreMenu({ requestId, status, projectId, outstanding }: { requestId: string; status: string; projectId?: string | null; outstanding: number }) {
  const [open, setOpen] = useState(false);
  if (status === "cancelled" || status === "closed" || status === "fulfilled") return null;
  return (
    <>
      <MoreMenu items={[{ key: "cancel", label: "Cancel this request", danger: true, onSelect: () => setOpen(true) }]} />
      {open ? (
        <Modal open onClose={() => setOpen(false)} title="Cancel this request" description="Reservations that were not used are released. Equipment that has already been dispatched stays outstanding until it is returned: cancelling does not bring it back.">
          <InvForm action={cancelRequest} submitLabel="Cancel the request" variant="destructive" onDone={() => setOpen(false)}>
            <input type="hidden" name="requestId" value={requestId} />
            {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
            <Field label={status === "draft" ? "Why (optional)" : "Why is it cancelled?"} htmlFor={`cr-${requestId}`} hint={status === "draft" ? undefined : "Needed once the warehouse has the request."}>
              <Input id={`cr-${requestId}`} name="reason" maxLength={200} required={status !== "draft"} />
            </Field>
            {outstanding > 0 ? <Alert variant="warning" role="status">Some equipment is already out. It stays outstanding until the warehouse records its return.</Alert> : null}
          </InvForm>
        </Modal>
      ) : null}
    </>
  );
}
