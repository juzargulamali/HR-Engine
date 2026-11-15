"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { dismissHandoverNotice } from "@/lib/actions/crmHandoverNotice";

/**
 * Dismiss on a "Handover accepted" row (and on a "question from Operations" row) in Sales Follow-ups. It marks the person's own notice as read, nothing else: the handover, the project and the other
 * person's notice are untouched. If it could not be saved the row stays and says so.
 */
export function DismissHandoverNotice({ noticeId, title, what = "handover accepted notice" }: { noticeId: string; title: string; /** What is dismissed, for the button's accessible name. */ what?: string }) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={`Dismiss the ${what} for ${title}`} data-testid="dismiss-handover-notice"
        onClick={() => start(async () => { const r = await dismissHandoverNotice(noticeId); setFailed(!r.ok); })}>
        {pending ? "Saving…" : "Dismiss"}
      </Button>
      {failed ? <span role="status" className="text-[13px] text-destructive">Could not dismiss it. Try again.</span> : null}
    </>
  );
}
