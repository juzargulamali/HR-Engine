"use client";

import { useState, useTransition } from "react";
import { cancelTimesheet, submitTimesheet } from "@/lib/actions/timesheets";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export function TimesheetActions({
  timesheetId,
  isDraft,
  isCancellable,
}: {
  timesheetId: string;
  isDraft: boolean;
  isCancellable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex gap-2">
          {isDraft ? (
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await submitTimesheet(timesheetId);
                  setError(result.error);
                })
              }
            >
              {pending ? "Submitting…" : "Submit for approval"}
            </Button>
          ) : null}
          {isCancellable ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await cancelTimesheet(timesheetId);
                  setError(result.error);
                })
              }
            >
              {pending ? "Cancelling…" : "Cancel timesheet"}
            </Button>
          ) : null}
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
      </CardContent>
    </Card>
  );
}
