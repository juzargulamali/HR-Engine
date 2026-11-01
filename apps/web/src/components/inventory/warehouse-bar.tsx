"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MapPin, ScanLine } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ALL_WAREHOUSES, WAREHOUSE_COOKIE, type WarehouseOption } from "@/lib/inventory/working-location";

/**
 * "You are working in …": always says which warehouse the screen is about, and offers a switcher only when there is a choice. The choice is
 * remembered in a cookie (only a convenience: the address wins, and the database checks the location on every movement), and it is kept in
 * the address so a link shows the same warehouse. Stock and History can also show every warehouse together.
 */
export function WarehouseBar({ options, currentId, all, allowAll, scanHref, multiCompany }: {
  options: readonly WarehouseOption[]; currentId: string | null; all: boolean; allowAll: boolean; scanHref: string; multiCompany: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const label = (o: WarehouseOption) => (multiCompany ? `${o.name} · ${o.companyName}` : o.name);
  const current = options.find((o) => o.id === currentId);
  const choose = (value: string) => {
    try { document.cookie = `${WAREHOUSE_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`; } catch { /* a convenience only */ }
    const q = new URLSearchParams(sp.toString());
    q.set("location", value);
    // A panel or record of another warehouse should not stay open under the new one.
    for (const k of ["open", "unit", "action", "employee", "project", "request", "codes", "transfer", "mode", "bin"]) q.delete(k);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const choices = options.length + (allowAll ? 1 : 0);
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3" role="group" aria-label="Warehouse">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <MapPin className="h-4 w-4 flex-none text-[hsl(var(--os-link))]" aria-hidden />
        <span className="text-sm text-muted-foreground">You are working in</span>
        {choices > 1 ? (
          <>
            <label htmlFor="warehouse-switch" className="sr-only">Warehouse</label>
            <Select id="warehouse-switch" value={all ? ALL_WAREHOUSES : (currentId ?? "")} onChange={(e) => choose(e.target.value)} className="h-10 w-full min-w-[14rem] font-semibold sm:h-9 sm:w-auto">
              {allowAll ? <option value={ALL_WAREHOUSES}>All warehouses</option> : null}
              {options.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
            </Select>
          </>
        ) : (
          <strong className="text-sm" data-testid="warehouse-label">{current ? label(current) : all ? "All warehouses" : "No warehouse yet"}</strong>
        )}
      </div>
      <Link href={scanHref} scroll={false} className={cn(buttonVariants(), "h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm")}>
        <ScanLine className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden />Scan a label
      </Link>
    </div>
  );
}
