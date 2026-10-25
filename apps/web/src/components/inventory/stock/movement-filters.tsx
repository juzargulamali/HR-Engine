"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { withParams } from "@/components/workspace/url-state";

/** The date range of the movements list, applied as it is chosen (it changes the address, so it can be shared and Back works). */
export function DateRangeFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const go = (patch: Record<string, string | null>) => start(() => router.replace(withParams(pathname, sp, { ...patch, page: null }), { scroll: false }));
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="mv-from" className="mb-1 block text-[13px] font-medium text-muted-foreground">From</label>
        <Input id="mv-from" type="date" value={from} max={to || undefined} onChange={(e) => go({ from: e.target.value || null })} className="w-[10.5rem]" />
      </div>
      <div>
        <label htmlFor="mv-to" className="mb-1 block text-[13px] font-medium text-muted-foreground">To</label>
        <Input id="mv-to" type="date" value={to} min={from || undefined} onChange={(e) => go({ to: e.target.value || null })} className="w-[10.5rem]" />
      </div>
    </div>
  );
}
