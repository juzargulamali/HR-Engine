"use client";

import { useActionState } from "react";
import { issueLetter } from "@/lib/actions/letters";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function IssueLetterForm({
  employees,
  templates,
}: {
  employees: { id: string; first_name: string; last_name: string }[];
  templates: { id: string; name: string; template_type: string; requires_approval: boolean }[];
}) {
  const [state, formAction, pending] = useActionState(issueLetter, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="employeeId">Employee</Label>
        <Select id="employeeId" name="employeeId" defaultValue="" required>
          <option value="" disabled>
            Select…
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.first_name} {e.last_name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="templateId">Template</Label>
        <Select id="templateId" name="templateId" defaultValue="" required>
          <option value="" disabled>
            Select…
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} {t.requires_approval ? "(needs CEO/CTO sign-off)" : ""}
            </option>
          ))}
        </Select>
      </div>
      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Issuing…" : "Issue letter"}
      </Button>
    </form>
  );
}
