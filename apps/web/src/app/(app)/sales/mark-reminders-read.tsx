"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markRemindersRead } from "@/lib/actions/crm";

/**
 * Marks reminders read. With `reminderIds` it dismisses those rows (the one reminder shown for a follow-up and every other unread row about the same
 * follow-up); without, all of the person's unread reminders. A refusal, whole or partial, is shown beside the button and the reminder stays listed.
 * (markRemindersRead takes ids, not form data, so this is a button rather than a plain form action.)
 */
export function MarkRemindersReadButton({ reminderIds, label = "Mark all read", about }: { reminderIds?: readonly string[]; label?: string; /** What is dismissed, for the button's accessible name. */ about?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
      {error ? <span role="alert" className="text-sm font-medium text-[hsl(var(--os-red))]">{error}</span> : null}
      <Button
        type="button" size="sm" variant="ghost" disabled={pending} aria-label={about ? `${label}: ${about}` : undefined}
        onClick={() => start(async () => {
          setError(null);
          try {
            const r = await markRemindersRead(reminderIds ? [...reminderIds] : undefined);
            if (r.error) setError(r.error);
          } catch {
            setError("Could not reach the server. Try again.");
          }
        })}
      >
        {pending ? "Saving…" : label}
      </Button>
    </span>
  );
}
