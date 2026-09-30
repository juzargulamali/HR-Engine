"use client";

import { useState, useTransition } from "react";
import { resolveRecoveryCreditProjectLead } from "@/lib/actions/attendanceClocking";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

/**
 * Supplies the missing project lead for a self-clock recovery-credit
 * candidate that never captured one (Office/WFH work only requires a lead
 * "when relevant" — see resolve_recovery_credit_project_lead()'s own doc
 * comment in schema.sql). Never guesses the approver and never discards the
 * candidate while it's waiting.
 */
export function ResolveProjectLeadForm({
  requestId,
  workDate,
  proposedDays,
  colleagues,
}: {
  requestId: string;
  workDate: string;
  proposedDays: number;
  colleagues: { id: string; first_name: string; last_name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [projectLeadEmployeeId, setProjectLeadEmployeeId] = useState("");

  function submit() {
    if (!projectLeadEmployeeId) {
      setError("Select a project lead.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await resolveRecoveryCreditProjectLead({ requestId, projectLeadEmployeeId });
      setError(result.error);
      setSaved(!result.error);
    });
  }

  if (saved) {
    return <Alert variant="success">Routed for approval.</Alert>;
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">
          {workDate} — {proposedDays} day(s)
        </p>
        <Label htmlFor={`lead-${requestId}`} className="text-xs">
          Project lead
        </Label>
        <Select id={`lead-${requestId}`} value={projectLeadEmployeeId} onChange={(e) => setProjectLeadEmployeeId(e.target.value)} className="w-56">
          <option value="">Select…</option>
          {colleagues.map((c) => (
            <option key={c.id} value={c.id}>
              {c.first_name} {c.last_name}
            </option>
          ))}
        </Select>
      </div>
      <Button size="sm" disabled={pending} onClick={submit}>
        {pending ? "Saving…" : "Route for approval"}
      </Button>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}
