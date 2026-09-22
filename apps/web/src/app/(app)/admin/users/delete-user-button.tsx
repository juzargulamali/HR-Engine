"use client";

import { useState, useTransition } from "react";
import { deleteUserAccount } from "@/lib/actions/users";
import { Button } from "@/components/ui/button";

export function DeleteUserButton({ userId, email }: { userId: string; email: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Permanently delete ${email}'s login? This can't be undone.`)) return;
          startTransition(async () => {
            const result = await deleteUserAccount(userId);
            setError(result.error);
          });
        }}
      >
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {error ? <p className="max-w-[220px] text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
