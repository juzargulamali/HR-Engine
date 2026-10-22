"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { QrScanner } from "@/components/inventory/qr-scanner";
import { readCode } from "@/lib/actions/inventoryStock";
import { withParams } from "@/components/workspace/url-state";
import type { ScanResolution } from "@/lib/inventory/stock-candidates";

/**
 * Scan a label to look something up. A unit code opens that unit's panel; a bin label opens the item with that bin in view; an unknown
 * code, or one you may not see, says so and shows nothing about it. Scanning here NEVER changes stock: to move stock, use a form.
 */
export function ScanPanelBody({ read = readCode }: { read?: (raw: string) => Promise<ScanResolution> }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onRead = async (raw: string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await read(raw);
      if (!res.ok) { setMessage(res.message); return; }
      const patch = res.kind === "unit"
        ? { action: null, open: null, bin: null, unit: res.unitId }
        : { action: null, unit: null, open: res.itemId, bin: res.code };
      router.push(withParams(pathname, sp, patch), { scroll: false });
    } catch {
      setMessage("The code could not be looked up right now. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Point the camera at a QR label, or type the code. A unit label opens that unit. A bin label opens the item with that bin in view. Scanning never changes any stock.</p>
      <QrScanner onRead={(raw) => { void onRead(raw); }} />
      <div role="status" aria-live="polite">{message ? <Alert variant="warning">{message}</Alert> : busy ? <p className="text-sm text-muted-foreground">Looking it up…</p> : null}</div>
    </div>
  );
}
