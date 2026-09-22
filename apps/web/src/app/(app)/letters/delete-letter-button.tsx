"use client";

import { useState, useTransition } from "react";
import { deleteLetter } from "@/lib/actions/letters";
import { Button } from "@/components/ui/button";

export function DeleteLetterButton({ letterId }: { letterId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Delete this letter? This can't be undone.")) return;
          startTransition(async () => {
            const result = await deleteLetter(letterId);
            setError(result.error);
          });
        }}
      >
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
