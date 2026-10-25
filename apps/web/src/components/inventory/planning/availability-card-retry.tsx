"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Shown in place of the warehouse stock check when it could not be loaded (the data service did not answer). The card is never hidden for
 * that: a missing card reads as "nothing to see", which is wrong. Retry asks the server for the card again without leaving the panel.
 */
export function AvailabilityCardRetry() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <section aria-label="Warehouse stock check" className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Warehouse stock check</h3>
      <Alert variant="warning" role="alert" className="mt-3">
        <p>Could not load—retry</p>
        <p className="mt-1 text-sm">The stock check for this enquiry did not load. Nothing is wrong with the enquiry itself.</p>
      </Alert>
      <div className="mt-3">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(() => router.refresh())}>{pending ? "Retrying…" : "Retry"}</Button>
      </div>
    </section>
  );
}
