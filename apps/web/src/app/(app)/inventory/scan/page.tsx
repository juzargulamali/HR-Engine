import { redirect } from "next/navigation";
import { PageHeader } from "@/components/projects/parts";
import { ScanView, type ScanNotice } from "@/components/inventory/setup/scan-view";
import { resolveScan } from "@/lib/inventory/scan-lookup";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Scan a label" };

/**
 * `/inventory/scan` is the in-app scanner. `/inventory/scan?c=CODE` is the address printed in a label's QR code: signed-out visitors are sent
 * to sign-in by the app shell and come back here. A code the person may see opens its record; anything else gets one safe message that does
 * not say whether the code exists. Nothing on this route changes stock.
 */
export default async function InventoryScanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.c) ? sp.c[0] : sp.c) ?? "";
  let initial: ScanNotice | null = null;
  if (raw.trim() !== "") {
    const resolution = await resolveScan(await createClient(), raw);
    if (resolution.status === "found") redirect(resolution.openHref);
    initial = { raw, resolution };
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Scan a label" description="Read a QR label with the camera, or type the code printed on it. Scanning only finds the record: it never changes stock." />
      <ScanView initial={initial} />
    </div>
  );
}
