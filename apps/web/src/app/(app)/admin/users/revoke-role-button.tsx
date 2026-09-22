"use client";

import { useState, useTransition } from "react";
import { revokeRole } from "@/lib/actions/users";
import { Button } from "@/components/ui/button";

export function RevokeRoleButton({ roleGrantId }: { roleGrantId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-5 px-1 text-[10px]"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Revoke this role? They lose the access it grants immediately.")) return;
          startTransition(async () => setError((await revokeRole(roleGrantId)).error));
        }}
      >
        {pending ? "revoking…" : "revoke"}
      </Button>
      {error ? <span className="text-[10px] text-destructive">{error}</span> : null}
    </span>
  );
}
