"use client";

import { useState, useTransition } from "react";
import { acknowledgeAppraisal, submitAppraisal } from "@/lib/actions/performance";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export function AppraisalActions({
  appraisalId,
  canSubmit,
  canAcknowledge,
}: {
  appraisalId: string;
  canSubmit: boolean;
  canAcknowledge: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex gap-2">
          {canSubmit ? (
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await submitAppraisal(appraisalId);
                  setError(result.error);
                })
              }
            >
              {pending ? "Submitting…" : "Submit to employee"}
            </Button>
          ) : null}
          {canAcknowledge ? (
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await acknowledgeAppraisal(appraisalId);
                  setError(result.error);
                })
              }
            >
              {pending ? "Acknowledging…" : "Acknowledge"}
            </Button>
          ) : null}
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
      </CardContent>
    </Card>
  );
}
