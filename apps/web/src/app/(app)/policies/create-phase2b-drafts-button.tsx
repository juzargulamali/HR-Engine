"use client";

import { useState, useTransition } from "react";
import { createPhase2bPolicyDrafts, type Phase2bDraftResult } from "@/lib/actions/policies";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/**
 * One-click authenticated path to seed_phase2b_policy_drafts() — replaces
 * the browser-console/SQL-Editor workaround. Calls it through the same
 * server-client pattern every other action on this page already uses, so
 * the actor is this signed-in user's own auth.uid(), never a token or id
 * exposed to (or supplied by) the browser. Hidden once all 12 intended
 * v2 drafts already exist (nothing left for it to do); the real
 * authorization/idempotency guarantees still live in the RPC itself.
 */
export function CreatePhase2bDraftsButton({ allCreated }: { allCreated: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Phase2bDraftResult[] | null>(null);

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
              "Create the corrected Phase 2B v2 draft policies for UAE, Saudi Arabia and Poland (leave rules, notice period, probation rules, Recovery Leave)? This only creates draft records — nothing is activated.",
            )
          ) {
            return;
          }
          startTransition(async () => {
            const result = await createPhase2bPolicyDrafts();
            setError(result.error);
            setResults(result.results);
          });
        }}
      >
        {pending ? "Creating…" : "Create corrected Phase 2B drafts"}
      </Button>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {results && results.length > 0 ? (
        <ul className="rounded-md border border-border p-2 text-xs text-muted-foreground">
          {results.map((r) => (
            <li key={`${r.countryCode}-${r.policyType}`}>
              {r.countryCode} {r.policyType}: {r.action}
              {r.versionNo ? ` (v${r.versionNo})` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
