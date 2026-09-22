"use client";

import { useTransition } from "react";
import { closePerformanceCycle } from "@/lib/actions/performance";
import { Button } from "@/components/ui/button";

export function CloseCycleButton({ cycleId }: { cycleId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(() => closePerformanceCycle(cycleId))}>
      {pending ? "Closing…" : "Close cycle"}
    </Button>
  );
}
