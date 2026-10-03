"use client";

import { useState, useTransition } from "react";
import { createRecoveryWindowsPolicyDrafts, type RecoveryWindowsDraftResult } from "@/lib/actions/recoveryWindows";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/**
 * One-click path to seed_recovery_windows_policy_drafts(): creates the NEXT
 * Recovery Leave version (working-period / 24-elapsed-hour windows) as a DRAFT
 * for UAE, Saudi Arabia and Poland. The actor is this signed-in HR Admin's own
 * auth.uid() (decided in the database, never supplied by the browser). It only
 * creates drafts: the active Recovery Leave version is untouched, and nothing
 * is activated — activation is a separate, controlled step with a chosen
 * effective date.
 */
export function CreateRecoveryWindowsDraftsButton({ allCreated }: { allCreated: boolean }) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<RecoveryWindowsDraftResult | null>(null);

  if (allCreated) return null;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              "Create the next Recovery Leave version (working periods and 24-hour windows) as DRAFTS for UAE, Saudi Arabia and Poland? The current active version is not changed and nothing is activated.",
            )
          ) {
            return;
          }
          startTransition(async () => setOutcome(await createRecoveryWindowsPolicyDrafts()));
        }}
      >
        {pending ? "Creating…" : "Create Recovery Leave (windows) drafts"}
      </Button>
      {outcome?.error ? <Alert variant="destructive">{outcome.error}</Alert> : null}
      {outcome && outcome.results.length > 0 ? (
        <ul className="rounded-md border border-border p-2 text-xs text-muted-foreground">
          {outcome.results.map((r) => (
            <li key={r.countryCode}>
              {r.countryCode}: {r.action === "created" ? `draft v${r.versionNo} created` : "already created — skipped"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
