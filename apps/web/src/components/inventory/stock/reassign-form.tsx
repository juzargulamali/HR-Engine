"use client";

import { useState } from "react";
import { reassignUnit } from "@/lib/actions/inventoryStock";
import { ActionForm, Field } from "@/components/sales/action-form";
import { EmployeePicker } from "@/components/inventory/planning/pickers";
import { Textarea } from "@/components/ui/textarea";
import { newMovementKey } from "@/lib/inventory/idempotency";

/**
 * Change who holds a unit that is with an employee: back to the project pool, or to another employee. A reason is always needed and
 * the history keeps who held it before. The key made when the form opens is sent every time, so a double click records once.
 */
export function ReassignUnitForm({ unit, companyId, holder, poolPlace }: { unit: { id: string; code: string }; companyId: string; holder: string; poolPlace: string | null }) {
  // One key per opening of this form (it is made again each time the dialog is opened), so a repeated click can only repeat the same request.
  const [key] = useState(() => newMovementKey("reassign"));
  const [to, setTo] = useState<"pool" | "employee">("pool");
  return (
    <ActionForm action={reassignUnit} submitLabel="Record the change" pendingLabel="Recording…">
      <input type="hidden" name="unitId" value={unit.id} />
      <input type="hidden" name="key" value={key} />
      <p className="text-sm text-muted-foreground"><strong>{unit.code}</strong> is recorded as held by <strong>{holder}</strong>. This changes the record only: nothing is dispatched or counted again.</p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Where does it go?</legend>
        <label className="flex items-start gap-2 text-sm"><input type="radio" name="to" value="pool" checked={to === "pool"} onChange={() => setTo("pool")} className="mt-0.5" /><span><span className="font-medium">Back to the project pool</span><span className="block text-muted-foreground">It is recorded as in the warehouse{poolPlace ? ` at ${poolPlace}` : ""} and can be reserved again.</span></span></label>
        <label className="flex items-start gap-2 text-sm"><input type="radio" name="to" value="employee" checked={to === "employee"} onChange={() => setTo("employee")} className="mt-0.5" /><span><span className="font-medium">To another employee</span><span className="block text-muted-foreground">It stays out of the pool.</span></span></label>
      </fieldset>
      {to === "employee" ? <EmployeePicker companyId={companyId} /> : null}
      <Field label="Why?" htmlFor={`ra-why-${unit.id}`} hint="Required. It is kept with the record, for example: the employee left and the laptop was handed to the team."><Textarea id={`ra-why-${unit.id}`} name="reason" rows={2} required maxLength={2000} /></Field>
    </ActionForm>
  );
}
