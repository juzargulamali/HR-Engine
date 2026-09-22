"use client";

import { useActionState } from "react";
import { createPerformanceCycle } from "@/lib/actions/performance";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function NewCycleForm({ companies }: { companies: { id: string; legal_name: string }[] }) {
  const [state, formAction, pending] = useActionState(createPerformanceCycle, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {companies.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="companyId">Company</Label>
          <Select id="companyId" name="companyId" defaultValue={companies[0]?.id} required>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legal_name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <input type="hidden" name="companyId" value={companies[0]?.id} />
      )}

      <div className="space-y-1.5">
        <Label htmlFor="name">Cycle name</Label>
        <Input id="name" name="name" placeholder="e.g. 2026 Annual Review" required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="periodStart">Period start</Label>
          <Input id="periodStart" name="periodStart" type="date" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="periodEnd">Period end</Label>
          <Input id="periodEnd" name="periodEnd" type="date" required />
        </div>
      </div>

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Start cycle"}
      </Button>
    </form>
  );
}
