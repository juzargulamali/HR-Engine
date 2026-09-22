"use client";

import { useState, useTransition } from "react";
import { cancelClaim, submitClaim } from "@/lib/actions/reimbursements";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export function ClaimActions({ claimId, isDraft, isCancellable }: { claimId: string; isDraft: boolean; isCancellable: boolean }) {
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
                  const result = await submitClaim(claimId);
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
                  const result = await cancelClaim(claimId);
                  setError(result.error);
                })
              }
            >
              {pending ? "Cancelling…" : "Cancel claim"}
            </Button>
          ) : null}
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
      </CardContent>
    </Card>
  );
}
