"use client";

import { useState, useTransition } from "react";
import { deletePayrollRun, markPayrollSent, regenerateLines, submitPayrollRun } from "@/lib/actions/payroll";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export function RunActions({
  runId,
  companyId,
  status,
  sentAt,
}: {
  runId: string;
  companyId: string;
  status: string;
  sentAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap gap-2">
          {status === "draft" ? (
            <>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await regenerateLines(runId);
                    setError(result.error);
                  })
                }
              >
                {pending ? "Refreshing…" : "Re-check for new lines"}
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await submitPayrollRun(runId, companyId);
                    setError(result.error);
                  })
                }
              >
                {pending ? "Submitting…" : "Submit for approval"}
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm("Delete this draft run? Its lines are removed too, and their source claims/encashments become available for a future run.")) return;
                  startTransition(async () => {
                    const result = await deletePayrollRun(runId);
                    setError(result.error);
                  });
                }}
              >
                {pending ? "Deleting…" : "Delete draft"}
              </Button>
            </>
          ) : null}
          {status === "approved" && !sentAt ? (
            <Button
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Mark this run as sent? This confirms the file has actually gone to the payroll provider.")) return;
                startTransition(async () => {
                  const result = await markPayrollSent(runId);
                  setError(result.error);
                });
              }}
            >
              {pending ? "Marking…" : "Mark as sent"}
            </Button>
          ) : null}
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
      </CardContent>
    </Card>
  );
}
