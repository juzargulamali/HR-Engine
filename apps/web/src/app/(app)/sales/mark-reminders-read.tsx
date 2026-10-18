"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markRemindersRead } from "@/lib/actions/crm";

/**
 * Marks reminders read. With a `reminderId` it dismisses that one; without, all of the person's unread reminders.
 * (markRemindersRead takes an id, not form data, so this is a button rather than a plain form action.)
 */
export function MarkRemindersReadButton({ reminderId, label = "Mark all read" }: { reminderId?: string; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await markRemindersRead(reminderId); })}>
      {pending ? "Saving…" : label}
    </Button>
  );
}
