"use client";

import { useState, useTransition } from "react";
import { resendInvite } from "@/lib/actions/users";
import { Button } from "@/components/ui/button";

export function ResendInviteButton({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null } | null>(null);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(await resendInvite(email));
          })
        }
      >
        {pending ? "Sending…" : "Resend invite"}
      </Button>
      {result?.error ? <p className="text-xs text-destructive">{result.error}</p> : null}
      {result && !result.error ? <p className="text-xs text-muted-foreground">Sent.</p> : null}
    </div>
  );
}
