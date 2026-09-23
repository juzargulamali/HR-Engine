"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { updateAppraisal } from "@/lib/actions/performance";
import type { ActionState } from "@/lib/actions/companies";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

const COMPETENCIES = [
  { name: "qualityOfWorkRating", label: "Quality of work" },
  { name: "productivityRating", label: "Productivity" },
  { name: "initiativeRating", label: "Initiative & ownership" },
  { name: "teamworkRating", label: "Teamwork & collaboration" },
  { name: "punctualityRating", label: "Punctuality/attendance" },
] as const;

export function AppraisalForm({
  appraisalId,
  qualityOfWorkRating,
  productivityRating,
  initiativeRating,
  teamworkRating,
  punctualityRating,
  strengths,
  areasForImprovement,
}: {
  appraisalId: string;
  qualityOfWorkRating: number | null;
  productivityRating: number | null;
  initiativeRating: number | null;
  teamworkRating: number | null;
  punctualityRating: number | null;
  strengths: string | null;
  areasForImprovement: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateAppraisal, initialState);

  const defaults: Record<(typeof COMPETENCIES)[number]["name"], number | null> = {
    qualityOfWorkRating,
    productivityRating,
    initiativeRating,
    teamworkRating,
    punctualityRating,
  };
  const [ratings, setRatings] = useState(defaults);

  const computedOverall = useMemo(() => {
    const values = Object.values(ratings).filter((v): v is number => v != null);
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  }, [ratings]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="appraisalId" value={appraisalId} />

      <div className="grid gap-4 sm:grid-cols-2">
        {COMPETENCIES.map(({ name, label }) => (
          <div key={name} className="space-y-1.5">
            <Label htmlFor={name}>{label}</Label>
            <Select
              id={name}
              name={name}
              defaultValue={defaults[name]?.toString() ?? ""}
              className="w-32"
              onChange={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                setRatings((prev) => ({ ...prev, [name]: v }));
              }}
            >
              <option value="">Not set</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label>Overall (auto-calculated)</Label>
        <div className="text-sm font-medium">{computedOverall ?? "Not set"}</div>
        <p className="text-xs text-muted-foreground">
          Computed as the rounded average of the competency ratings above once saved — shown here for immediate feedback.
        </p>
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
