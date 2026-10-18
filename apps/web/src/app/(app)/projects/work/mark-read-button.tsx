"use client";

import { useTransition } from "react";
import { markProjectNotificationsRead } from "@/lib/actions/projectsDiscussion";
import { Button } from "@/components/ui/button";

/** Marks every project notice as read. Nothing else changes; the notices stay listed. */
export function MarkAllRead({ unread }: { unread: number }) {
  const [pending, start] = useTransition();
  if (unread === 0) return null;
  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => start(async () => { await markProjectNotificationsRead(); })}>
      {pending ? "Marking…" : `Mark all as read (${unread})`}
    </Button>
  );
}
