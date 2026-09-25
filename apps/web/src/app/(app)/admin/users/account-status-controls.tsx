"use client";

import { useState, useTransition } from "react";
import type { AccountStatus } from "@/types/database.types";
import { deactivateAccount, reactivateAccount, adminSendPasswordReset } from "@/lib/actions/account-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATUS_LABEL: Record<AccountStatus, string> = {
  invited: "Invited",
  active: "Active",
  deactivated: "Deactivated — access suspended",
};

const STATUS_VARIANT: Record<AccountStatus, "secondary" | "success" | "destructive"> = {
  invited: "secondary",
  active: "success",
  deactivated: "destructive",
};

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

/**
 * window.prompt() for the reason, window.confirm()-adjacent to the
 * confirmation dialogs already used throughout this page (delete-user-button.tsx,
 * deactivate-or-restore-company-button.tsx) rather than introducing a
 * one-off dialog component for just this. A cancelled or blank prompt
 * aborts without calling the server action at all.
 */
export function AccountStatusControls({
  userId,
  status,
  isSelf,
}: {
  userId: string;
  status: AccountStatus;
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resetPending, startResetTransition] = useTransition();
  const [resetError, setResetError] = useState<string | null>(null);

  if (isSelf) {
    return <p className="text-xs text-muted-foreground">You can&apos;t change your own account status.</p>;
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {status === "deactivated" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            const reason = window.prompt("Reason for reactivating this account:");
            if (!reason || !reason.trim()) return;
            startTransition(async () => {
              setError((await reactivateAccount(userId, reason)).error);
            });
          }}
        >
          {pending ? "Reactivating…" : "Reactivate"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => {
            const reason = window.prompt("Reason for deactivating this account:");
            if (!reason || !reason.trim()) return;
            startTransition(async () => {
              setError((await deactivateAccount(userId, reason)).error);
            });
          }}
        >
          {pending ? "Deactivating…" : "Deactivate"}
        </Button>
      )}
      {error ? <p className="max-w-[220px] text-xs text-destructive">{error}</p> : null}

      {status !== "invited" ? (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={resetPending}
            onClick={() =>
              startResetTransition(async () => {
                setResetError((await adminSendPasswordReset(userId)).error);
              })
            }
          >
            {resetPending ? "Sending…" : "Send password reset"}
          </Button>
          {resetError ? <p className="max-w-[220px] text-xs text-destructive">{resetError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
