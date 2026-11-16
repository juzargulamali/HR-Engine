"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MapPin, ScanLine } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ALL_WAREHOUSES, WAREHOUSE_COOKIE, type WarehouseOption } from "@/lib/inventory/working-location";

/**
 * "You are working in …": always says which COMPANY and which WAREHOUSE the screen is about. A person with more than one company chooses the company first
 * (its short name: Enginious UAE, Enginious Saudi Arabia, Enginious Europe) and then a warehouse inside it; "All companies" is a viewing filter only (stock is
 * always posted against one company and one warehouse, which every form asks for). With one company there is one chooser, as before. The choice is remembered
 * in a cookie (only a convenience: the address wins, and the database checks the location on every movement) and kept in the address so a link shows the same.
 */
export function WarehouseBar({ options, currentId, all, allowAll, scanHref, multiCompany }: {
  options: readonly WarehouseOption[]; currentId: string | null; all: boolean; allowAll: boolean; scanHref: string; multiCompany: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = options.find((o) => o.id === currentId);
  const choose = (value: string) => {
    try { document.cookie = `${WAREHOUSE_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`; } catch { /* a convenience only */ }
    const q = new URLSearchParams(sp.toString());
    q.set("location", value);
    // A panel or record of another warehouse should not stay open under the new one.
    for (const k of ["open", "unit", "action", "employee", "project", "request", "codes", "transfer", "mode", "bin", "item"]) q.delete(k);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const companies = [...new Map(options.map((o) => [o.companyId, o.companyName])).entries()].map(([id, name]) => ({ id, name }));
  const companyId = current?.companyId ?? null;
  const inCompany = companyId ? options.filter((o) => o.companyId === companyId) : [];
  const chooseCompany = (value: string) => {
    if (value === ALL_WAREHOUSES) return choose(ALL_WAREHOUSES);
    const first = options.find((o) => o.companyId === value);
    if (first) choose(first.id);
  };
  const choices = options.length + (allowAll ? 1 : 0);
  const selectCls = "h-11 w-full min-w-[12rem] font-semibold sm:h-9 sm:w-auto";
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3" role="group" aria-label="Company and warehouse" data-company-id={companyId ?? ""} data-warehouse-id={currentId ?? ""}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <MapPin className="h-4 w-4 flex-none text-[hsl(var(--os-link))]" aria-hidden />
        <span className="text-sm text-muted-foreground">You are working in</span>
        {multiCompany && companies.length > 1 ? (
          <>
            <label htmlFor="company-switch" className="sr-only">Company</label>
            <Select id="company-switch" value={all ? ALL_WAREHOUSES : (companyId ?? "")} onChange={(e) => chooseCompany(e.target.value)} className={selectCls}>
              {allowAll ? <option value={ALL_WAREHOUSES}>All companies</option> : null}
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            {all ? <strong className="text-sm" data-testid="warehouse-label">All warehouses</strong> : (
              <>
                <label htmlFor="warehouse-switch" className="sr-only">Warehouse</label>
                <Select id="warehouse-switch" value={currentId ?? ""} onChange={(e) => choose(e.target.value)} className={selectCls}>
                  {inCompany.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </>
            )}
            <InfoHint label="company and warehouse">
              Choose the company, then one of its warehouses. All companies only changes what you see: every stock entry is still recorded against one company and one warehouse, which the form asks for.
            </InfoHint>
          </>
        ) : choices > 1 ? (
          <>
            {current || companies.length === 1 ? <strong className="text-sm" data-testid="company-label">{current?.companyName ?? companies[0]?.name}</strong> : null}
            <label htmlFor="warehouse-switch" className="sr-only">Warehouse</label>
            <Select id="warehouse-switch" value={all ? ALL_WAREHOUSES : (currentId ?? "")} onChange={(e) => choose(e.target.value)} className={selectCls}>
              {allowAll ? <option value={ALL_WAREHOUSES}>All warehouses</option> : null}
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </>
        ) : (
          <strong className="text-sm" data-testid="warehouse-label">{current ? `${current.companyName} · ${current.name}` : all ? "All warehouses" : "No warehouse yet"}</strong>
        )}
      </div>
      <Link href={scanHref} scroll={false} className={cn(buttonVariants(), "h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm")}>
        <ScanLine className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden />Scan a label
      </Link>
    </div>
  );
}
