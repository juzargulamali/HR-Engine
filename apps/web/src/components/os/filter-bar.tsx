"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListFilter, Search, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { withParams } from "@/components/workspace/url-state";
import type { ToolbarFilter } from "@/components/workspace/list-toolbar";

/**
 * A compact list toolbar: search, a Filters button that opens the filters in place, and whatever view controls the page puts beside them
 * (`children`). Everything applies as it is chosen by changing the address (so it can be shared and Back works), exactly like ListToolbar.
 * A filter that is on is always visible as a chip with its own remove link, so a narrowed list is never a mystery; the button counts them.
 */
export function OsFilterBar({ search, filters, clearHref, children }: { search: { value: string; placeholder: string }; filters: readonly ToolbarFilter[]; clearHref?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const panelId = useId();
  const [, start] = useTransition();
  const [text, setText] = useState(search.value);
  const [seen, setSeen] = useState(search.value);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in step when the address changes elsewhere (Back, Clear): adjust during render, not in an effect.
  if (search.value !== seen) { setSeen(search.value); setText(search.value); }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (patch: Record<string, string | null>) => start(() => router.replace(withParams(pathname, sp, patch), { scroll: false }));
  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() === "" ? null : v.trim().slice(0, 100) }), 300);
  };

  const active = filters.filter((f) => f.value !== "");
  const chipText = (f: ToolbarFilter) => `${f.label}: ${f.options.find((o) => o.value === f.value)?.label ?? f.value}`;

  return (
    <div role="search" className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <div className="relative order-last min-w-full flex-1 basis-full sm:order-none sm:min-w-[11rem] sm:basis-48">
          <label htmlFor="ob-q" className="sr-only">Search tasks</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id="ob-q" type="search" value={text} onChange={(e) => onSearch(e.target.value)} placeholder={search.placeholder} maxLength={100}
            className="os-search h-9 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <button
          type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}
          className="os-btn-outline inline-flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ListFilter className="h-4 w-4" aria-hidden /> Filters
          {active.length > 0 ? <span className="rounded-full bg-primary px-1.5 text-[12px] font-bold leading-5 text-primary-foreground" aria-label={`${active.length} in use`}>{active.length}</span> : null}
        </button>
      </div>

      {open ? (
        <div id={panelId} className="grid gap-3 rounded-xl border border-border bg-secondary/30 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {filters.map((f) => (
            <div key={f.name} className="min-w-0">
              <label htmlFor={`ob-${f.name}`} className="mb-1 block text-[13px] font-medium text-muted-foreground">{f.label}</label>
              <Select id={`ob-${f.name}`} value={f.value} onChange={(e) => go({ [f.name]: e.target.value || null })}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          ))}
        </div>
      ) : null}

      {active.length > 0 || search.value !== "" ? (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Filters in use">
          {search.value !== "" ? (
            <li><Chip label={`Search: ${search.value}`} remove={withParams(pathname, sp, { q: null })} what="search" /></li>
          ) : null}
          {active.map((f) => <li key={f.name}><Chip label={chipText(f)} remove={withParams(pathname, sp, { [f.name]: null })} what={f.label} /></li>)}
          {clearHref ? <li><Link href={clearHref} scroll={false} className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Clear all</Link></li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function Chip({ label, remove, what }: { label: string; remove: string; what: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.14)] py-0.5 pl-2.5 pr-1 text-[13px] font-medium">
      <span className="truncate">{label}</span>
      <Link href={remove} scroll={false} aria-label={`Remove filter: ${what}`} className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="h-3 w-3" aria-hidden />
      </Link>
    </span>
  );
}
