"use client";

import { useState, useTransition } from "react";
import { deleteLetterTemplate } from "@/lib/actions/letters";
import { Button } from "@/components/ui/button";

export function DeleteTemplateButton({ templateId }: { templateId: string }) {
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
          if (!window.confirm("Delete this template? Letters already issued from it are unaffected.")) return;
          startTransition(async () => setError((await deleteLetterTemplate(templateId)).error));
        }}
      >
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
