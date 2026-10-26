"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListFilter, Search, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { withParams } from "./url-state";

export interface ToolbarFilter {
  name: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  /** Less common filter: kept under a "More filters" disclosure, which opens by itself while one of them is set. */
  secondary?: boolean;
}

/**
 * Search and filters for a list. Everything is applied as it is chosen (no Apply button) by changing the address, so the result
 * can be shared and Back works. The record that is open in the side panel, the view, the sort and the columns are kept.
 * `resetKeys` are cleared whenever a filter changes (for example paging).
 */
export function ListToolbar({ search, filters, clearHref, resetKeys, children }: { search?: { value: string; placeholder: string; label?: string }; filters: readonly ToolbarFilter[]; clearHref?: string; /** Address parameters cleared whenever a filter or the search changes (for example the page number). */ resetKeys?: readonly string[]; children?: React.ReactNode }) {
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

  const go = (patch: Record<string, string | null>) => start(() => router.replace(withParams(pathname, sp, { ...Object.fromEntries((resetKeys ?? []).map((k) => [k, null])), ...patch }), { scroll: false }));
  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() === "" ? null : v.trim().slice(0, 100) }), 300);
  };
  const primary = filters.filter((f) => !f.secondary);
  const secondary = filters.filter((f) => f.secondary);
  const secondaryOn = secondary.filter((f) => f.value !== "");
  const secondaryActive = secondaryOn.length > 0;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const chipText = (f: ToolbarFilter) => `${f.label}: ${f.options.find((o) => o.value === f.value)?.label ?? f.value}`;
  const field = (f: ToolbarFilter) => (
    <div key={f.name} className="min-w-[8.5rem]">
      <label htmlFor={`lt-${f.name}`} className="mb-1 block text-[13px] font-medium text-muted-foreground">{f.label}</label>
      <Select id={`lt-${f.name}`} value={f.value} onChange={(e) => go({ [f.name]: e.target.value || null })}>
        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </div>
  );
  const active = filters.some((f) => f.value !== "") || (search?.value ?? "") !== "";

  return (
    <div className="flex flex-wrap items-end gap-3" role="search">
      {search ? (
        <div className="min-w-[14rem] flex-1 sm:max-w-sm">
          <label htmlFor="lt-q" className="sr-only">{search.label ?? "Search"}</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input id="lt-q" type="search" value={text} onChange={(e) => onSearch(e.target.value)} placeholder={search.placeholder} maxLength={100} className="os-search h-10 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
        </div>
      ) : null}
      {primary.map(field)}
      {secondary.length > 0 ? (
        <button
          type="button" aria-expanded={open || secondaryActive} aria-controls={panelId} onClick={() => setOpen((v) => !v)}
          className="os-btn-outline inline-flex h-10 items-center gap-2 rounded-lg border border-input px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ListFilter className="h-4 w-4" aria-hidden /> More filters
          {secondaryActive ? <span className="rounded-full bg-primary px-1.5 text-[12px] font-bold leading-5 text-primary-foreground" aria-label={`${secondaryOn.length} in use`}>{secondaryOn.length}</span> : null}
        </button>
      ) : null}
      {active && clearHref ? <Link href={clearHref} scroll={false} className="pb-2 text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Clear</Link> : null}
      {children ? <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div> : null}
      {secondary.length > 0 && (open || secondaryActive) ? (
        <div id={panelId} className="grid basis-full gap-3 rounded-xl border border-border bg-secondary/30 p-3 sm:grid-cols-2 lg:grid-cols-3">{secondary.map(field)}</div>
      ) : null}
      {secondaryActive ? (
        <ul className="flex basis-full flex-wrap items-center gap-2" aria-label="Filters in use">
          {secondaryOn.map((f) => (
            <li key={f.name} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.14)] py-0.5 pl-2.5 pr-1 text-[13px] font-medium">
              <span className="truncate">{chipText(f)}</span>
              <button type="button" aria-label={`Remove filter: ${f.label}`} onClick={() => go({ [f.name]: null })} className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-3 w-3" aria-hidden /></button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
