"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { withParams } from "@/components/workspace/url-state";

/** Which company the page is showing. Kept in the address (`?company=`), so the page can be shared and Back works. Shown only when there is a choice. */
export function CompanyPicker({ companies, value }: { companies: readonly { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  if (companies.length < 2) return null;
  return (
    <div className="max-w-xs">
      <label htmlFor="inv-company" className="mb-1 block text-[13px] font-medium text-muted-foreground">Company</label>
      <Select id="inv-company" value={value} onChange={(e) => router.replace(withParams(pathname, sp, { company: e.target.value }, ["count", "tech", "add"]), { scroll: false })}>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
    </div>
  );
}
