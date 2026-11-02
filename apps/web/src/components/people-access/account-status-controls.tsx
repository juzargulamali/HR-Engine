"use client";

import { useId, useState, useTransition } from "react";
import type { AccountStatus } from "@/types/database.types";
import {
  deactivateAccount,
  reactivateAccount,
  getAccountHoldings,
  adminSendPasswordReset,
  checkAccountStatusConsistency,
} from "@/lib/actions/account-status";
import { describeHoldings, type AccountHoldings } from "@/lib/people-access/holdings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

const REASON_HINT = "Do not enter passwords, tokens, or other sensitive information. Maximum 500 characters.";
const REASON_MAX_LENGTH = 500;

type HoldingsState = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; holdings: AccountHoldings };

/**
 * Deactivating asks for a reason in the page (not a browser dialog) and, first, shows what the person still holds: pending approvals, projects they manage,
 * roles, module access and equipment, and anything that stops the deactivation (the last active System Administrator, the only CEO / CTO approver or CEO / CTO
 * of a company: the database refuses those too). Nothing is re-routed by deactivating, and the panel says so. Reactivating asks for its reason the same way.
 * The length check here is a fast echo of set_account_status()'s own 500-character limit: the real enforcement is server-side.
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
  const [, startHoldingsTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resetPending, startResetTransition] = useTransition();
  const [resetError, setResetError] = useState<string | null>(null);
  const [checkPending, startCheckTransition] = useTransition();
  const [checkResult, setCheckResult] = useState<{ consistent: boolean; detail: string } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [mode, setMode] = useState<"deactivate" | "reactivate" | null>(null);
  const [reason, setReason] = useState("");
  const [holdings, setHoldings] = useState<HoldingsState>({ state: "loading" });
  const reasonId = useId();

  if (isSelf) {
    return <p className="text-sm text-muted-foreground">You can&apos;t change your own account status.</p>;
  }

  function loadHoldings() {
    setHoldings({ state: "loading" });
    startHoldingsTransition(async () => {
      const result = await getAccountHoldings(userId);
      setHoldings(result.holdings ? { state: "ready", holdings: result.holdings } : { state: "error", message: result.error ?? "Couldn't check what this account still holds." });
    });
  }

  function open(next: "deactivate" | "reactivate") {
    setMode(next);
    setReason("");
    setError(null);
    if (next === "deactivate") loadHoldings();
  }

  function close() {
    setMode(null);
    setReason("");
  }

  const trimmed = reason.trim();
  const blockers = holdings.state === "ready" ? holdings.holdings.blockers : [];
  const canConfirm = !pending && trimmed.length > 0 && trimmed.length <= REASON_MAX_LENGTH && (mode === "reactivate" || (holdings.state === "ready" && blockers.length === 0));

  function confirm() {
    if (!mode || !canConfirm) return;
    const which = mode;
    startTransition(async () => {
      const result = which === "deactivate" ? await deactivateAccount(userId, trimmed) : await reactivateAccount(userId, trimmed);
      setError(result.error);
      if (!result.error) close();
    });
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {status === "deactivated" ? (
        <Button type="button" variant="outline" size="sm" disabled={pending || mode !== null} onClick={() => open("reactivate")}>
          Reactivate
        </Button>
      ) : (
        <Button type="button" variant="destructive" size="sm" disabled={pending || mode !== null} onClick={() => open("deactivate")}>
          Deactivate
        </Button>
      )}
      {error ? <p className="max-w-[220px] text-sm text-destructive">{error}</p> : null}

      {mode ? (
        <div role="group" aria-label={mode === "deactivate" ? "Deactivate this account" : "Reactivate this account"} className="basis-full space-y-3 rounded-md border border-border p-3">
          <p className="text-sm font-semibold">{mode === "deactivate" ? "Deactivate this account" : "Reactivate this account"}</p>
          {mode === "deactivate" ? <HoldingsPanel holdings={holdings} onRetry={loadHoldings} /> : null}
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>Reason (required)</Label>
            <Textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX_LENGTH} rows={3} aria-describedby={`${reasonId}-hint`} />
            <p id={`${reasonId}-hint`} className="text-xs text-muted-foreground">{REASON_HINT} {REASON_MAX_LENGTH - reason.length} left.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={mode === "deactivate" ? "destructive" : "default"} disabled={!canConfirm} onClick={confirm}>
              {pending ? (mode === "deactivate" ? "Deactivating…" : "Reactivating…") : mode === "deactivate" ? "Deactivate account" : "Reactivate account"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={close}>Cancel</Button>
          </div>
        </div>
      ) : null}

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
          {resetError ? <p className="max-w-[220px] text-sm text-destructive">{resetError}</p> : null}
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
        {checkError ? <p className="max-w-[220px] text-sm text-destructive">{checkError}</p> : null}
        {checkResult ? (
          <p className={`max-w-[220px] text-sm ${checkResult.consistent ? "text-muted-foreground" : "text-destructive"}`}>
            {checkResult.detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function HoldingsPanel({ holdings, onRetry }: { holdings: HoldingsState; onRetry: () => void }) {
  if (holdings.state === "loading") return <p role="status" className="text-sm text-muted-foreground">Checking what this person still holds…</p>;
  if (holdings.state === "error") {
    return (
      <Alert variant="destructive">
        {holdings.message}{" "}
        <button type="button" className="font-medium underline underline-offset-2" onClick={onRetry}>Try again</button>
      </Alert>
    );
  }
  const lines = describeHoldings(holdings.holdings);
  return (
    <div className="space-y-2">
      {holdings.holdings.blockers.map((b) => <Alert key={b} variant="destructive">{b}</Alert>)}
      {lines.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">This person still:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </div>
      ) : <p className="text-sm text-muted-foreground">Nothing is waiting on this person and they hold no projects, teams or equipment.</p>}
      <p className="text-sm text-muted-foreground">From now on new requests skip this person, and they can no longer be picked as a project manager, team head or approver.</p>
    </div>
  );
}
