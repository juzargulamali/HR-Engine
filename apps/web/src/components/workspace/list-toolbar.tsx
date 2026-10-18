"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { withParams } from "./url-state";

export interface ToolbarFilter {
  name: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
}

/**
 * Search and filters for a list. Everything is applied as it is chosen (no Apply button) by changing the address, so the result
 * can be shared and Back works. The record that is open in the side panel, the view, the sort and the columns are kept.
 * `resetKeys` are cleared whenever a filter changes (for example paging).
 */
export function ListToolbar({ search, filters, clearHref, children }: { search?: { value: string; placeholder: string; label?: string }; filters: readonly ToolbarFilter[]; clearHref?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const [text, setText] = useState(search?.value ?? "");
  const [seen, setSeen] = useState(search?.value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in step when the address changes elsewhere (Back, Clear): adjust during render, not in an effect.
  if ((search?.value ?? "") !== seen) {
    setSeen(search?.value ?? "");
    setText(search?.value ?? "");
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (patch: Record<string, string | null>) => start(() => router.replace(withParams(pathname, sp, patch), { scroll: false }));
  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() === "" ? null : v.trim().slice(0, 100) }), 300);
  };
  const active = filters.some((f) => f.value !== "") || (search?.value ?? "") !== "";

  return (
    <div className="flex flex-wrap items-end gap-3" role="search">
      {search ? (
        <div className="min-w-[14rem] flex-1 sm:max-w-sm">
          <label htmlFor="lt-q" className="sr-only">{search.label ?? "Search"}</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="lt-q" type="search" value={text} onChange={(e) => onSearch(e.target.value)} placeholder={search.placeholder} maxLength={100} className="pl-9" />
          </div>
        </div>
      ) : null}
      {filters.map((f) => (
        <div key={f.name} className="min-w-[8.5rem]">
          <label htmlFor={`lt-${f.name}`} className="mb-1 block text-[13px] font-medium text-muted-foreground">{f.label}</label>
          <Select id={`lt-${f.name}`} value={f.value} onChange={(e) => go({ [f.name]: e.target.value || null })}>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
      ))}
      {active && clearHref ? <Link href={clearHref} scroll={false} className="pb-2 text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Clear</Link> : null}
      {children ? <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
