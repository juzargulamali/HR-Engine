"use client";

import { importHandover } from "@/lib/actions/inventoryPlanning";
import { InvForm } from "./inv-form";

/** Run the Sales handover import again. It is safe to repeat: the same handover never creates a second draft. */
export function ImportHandoverButton({ projectId, label }: { projectId: string; label: string }) {
  return (
    <InvForm action={importHandover} submitLabel={label} pendingLabel="Importing…" variant="outline" className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
    </InvForm>
  );
}
