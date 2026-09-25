"use client";

import { useState, useTransition } from "react";
import type { AccountStatus } from "@/types/database.types";
import {
  deactivateAccount,
  reactivateAccount,
  adminSendPasswordReset,
  checkAccountStatusConsistency,
} from "@/lib/actions/account-status";
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

const REASON_PROMPT_SUFFIX = " (do not enter passwords, tokens, or other sensitive information — max 500 characters):";
const REASON_MAX_LENGTH = 500;

/**
 * window.prompt() for the reason, window.confirm()-adjacent to the
 * confirmation dialogs already used throughout this page (delete-user-button.tsx,
 * deactivate-or-restore-company-button.tsx) rather than introducing a
 * one-off dialog component for just this. A cancelled or blank prompt
 * aborts without calling the server action at all. The length check here is
 * a fast client-side echo of set_account_status()'s own 500-char limit — the
 * real enforcement is server-side, this just avoids a round trip for the
 * obvious case.
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
  const [checkPending, startCheckTransition] = useTransition();
  const [checkResult, setCheckResult] = useState<{ consistent: boolean; detail: string } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

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
            const reason = window.prompt(`Reason for reactivating this account${REASON_PROMPT_SUFFIX}`);
            if (!reason || !reason.trim()) return;
            if (reason.trim().length > REASON_MAX_LENGTH) {
              setError(`Reason is too long (${REASON_MAX_LENGTH} characters max).`);
              return;
            }
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
            const reason = window.prompt(`Reason for deactivating this account${REASON_PROMPT_SUFFIX}`);
            if (!reason || !reason.trim()) return;
            if (reason.trim().length > REASON_MAX_LENGTH) {
              setError(`Reason is too long (${REASON_MAX_LENGTH} characters max).`);
              return;
            }
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

      <div className="space-y-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={checkPending}
          onClick={() =>
            startCheckTransition(async () => {
              const result = await checkAccountStatusConsistency(userId);
              setCheckError(result.error);
              setCheckResult(result.error ? null : { consistent: result.consistent, detail: result.detail });
            })
          }
        >
          {checkPending ? "Checking…" : "Check status"}
        </Button>
        {checkError ? <p className="max-w-[220px] text-xs text-destructive">{checkError}</p> : null}
        {checkResult ? (
          <p className={`max-w-[220px] text-xs ${checkResult.consistent ? "text-muted-foreground" : "text-destructive"}`}>
            {checkResult.detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}
