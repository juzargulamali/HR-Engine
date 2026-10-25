"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { recordInventoryLabelPrints } from "@/lib/actions/inventorySetup";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface PrintTarget { companyId: string; unitId?: string; balanceId?: string }

/**
 * Print the sheet and write the print history. The browser's print dialog opens straight away; the history is written alongside it and the
 * result is shown. A reprint is the same code printed again: it is a history row, never a new asset. If the history cannot be written the
 * labels can still be printed, and the page says so.
 */
export function PrintButton({ targets }: { targets: readonly PrintTarget[] }) {
  const [status, setStatus] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function print() {
    setStatus(null);
    setBusy(true);
    const recording = recordInventoryLabelPrints([...targets]).catch(() => ({ recorded: 0, failed: targets.length, error: "The print history could not be updated." }));
    window.print();
    const r = await recording;
    setBusy(false);
    if (r.failed === 0) setStatus({ kind: "ok", text: `Print history updated for ${r.recorded} ${r.recorded === 1 ? "label" : "labels"}.` });
    else setStatus({ kind: "warn", text: `${r.recorded > 0 ? `History updated for ${r.recorded}, but not for ${r.failed}` : "The print history was not updated"}${r.error ? `: ${r.error}` : "."} The labels can still be printed.` });
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={() => void print()} disabled={busy || targets.length === 0}><Printer className="h-4 w-4" aria-hidden /> {busy ? "Printing…" : "Print"}</Button>
      {status ? <Alert variant={status.kind === "ok" ? "success" : "warning"} role="status">{status.text}</Alert> : null}
    </div>
  );
}
