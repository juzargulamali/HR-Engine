"use client";

import { useActionState } from "react";
import { updateAppraisal } from "@/lib/actions/performance";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

export function AppraisalForm({
  appraisalId,
  overallRating,
  strengths,
  areasForImprovement,
}: {
  appraisalId: string;
  overallRating: number | null;
  strengths: string | null;
  areasForImprovement: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateAppraisal, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="appraisalId" value={appraisalId} />

      <div className="space-y-1.5">
        <Label htmlFor="overallRating">Overall rating</Label>
        <Select id="overallRating" name="overallRating" defaultValue={overallRating?.toString() ?? ""} className="w-32">
          <option value="">Not set</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="strengths">Strengths</Label>
        <Textarea id="strengths" name="strengths" defaultValue={strengths ?? ""} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="areasForImprovement">Areas for improvement</Label>
        <Textarea id="areasForImprovement" name="areasForImprovement" defaultValue={areasForImprovement ?? ""} />
      </div>

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save draft"}
      </Button>
    </form>
  );
}
