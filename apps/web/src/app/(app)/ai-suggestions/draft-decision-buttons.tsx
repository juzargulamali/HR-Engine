"use client";

import { useState, useTransition } from "react";
import { authorizeAiDraft, rejectAiDraft } from "@/lib/actions/aiDrafts";
import { Button } from "@/components/ui/button";

export function DraftDecisionButtons({ draftId }: { draftId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await authorizeAiDraft(draftId);
              setError(result.error);
            })
          }
        >
          Authorize
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await rejectAiDraft(draftId);
              setError(result.error);
            })
          }
        >
          Reject
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
