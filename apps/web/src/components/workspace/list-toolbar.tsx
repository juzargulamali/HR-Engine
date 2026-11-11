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
  /** The choices of a "select" filter (the default kind). Not used by the other kinds. */
  options?: readonly { value: string; label: string }[];
  /**
   * "select" (the default) is a list of choices. "text" is a short typed filter, applied a moment after typing stops. "date" is a date, applied when a
   * whole date is chosen or the field is emptied. "toggle" is a tick box whose value is "1" when ticked.
   */
  kind?: "select" | "text" | "date" | "toggle";
  placeholder?: string;
  /** Less common filter: kept under a "More filters" disclosure, which opens by itself while one of them is set. */
  secondary?: boolean;
  /** A chooser that is not a filter (for example which company's list is shown): it never counts as "in use", shows no chip and is left alone by Clear. */
  scopeOnly?: boolean;
}

/** A typed or date filter. It keeps its own text so the address catching up never interrupts typing, and follows the address when that changes elsewhere (Back, Clear, a chip). */
function TypedFilter({ f, apply }: { f: ToolbarFilter; apply: (value: string) => void }) {
  const [text, setText] = useState(f.value);
  const [seen, setSeen] = useState(f.value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (f.value !== seen) { setSeen(f.value); setText(f.value); }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const date = f.kind === "date";
  const onChange = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    if (date) apply(v);
    else timer.current = setTimeout(() => apply(v.trim().slice(0, 100)), 300);
  };
  return (
    <input id={`lt-${f.name}`} type={date ? "date" : "text"} value={text} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} maxLength={date ? undefined : 100}
      className="os-search h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
  );
}

/** A tick box. It shows the new state at once (the address catches up a moment later) and follows the address when that changes elsewhere. */
function ToggleFilter({ f, apply }: { f: ToolbarFilter; apply: (on: boolean) => void }) {
  const [on, setOn] = useState(f.value !== "");
  const [seen, setSeen] = useState(f.value);
  if (f.value !== seen) { setSeen(f.value); setOn(f.value !== ""); }
  return (
    <label className="flex h-10 items-center gap-2 text-sm font-medium">
      <input id={`lt-${f.name}`} type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); apply(e.target.checked); }} className="h-4 w-4" /> {f.label}
    </label>
  );
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

  // Two filters changed in quick succession: the second builds on the first even when the address has not caught up yet, so neither is lost.
  const spText = sp.toString();
  const latest = useRef(spText);
  useEffect(() => { latest.current = spText; }, [spText]);
  const go = (patch: Record<string, string | null>) => {
    const next = withParams(pathname, new URLSearchParams(latest.current), { ...Object.fromEntries((resetKeys ?? []).map((k) => [k, null])), ...patch });
    latest.current = next.includes("?") ? next.slice(next.indexOf("?") + 1) : "";
    start(() => router.replace(next, { scroll: false }));
  };
  const onSearch = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() === "" ? null : v.trim().slice(0, 100) }), 300);
  };
  const primary = filters.filter((f) => !f.secondary);
  const secondary = filters.filter((f) => f.secondary);
  const secondaryOn = secondary.filter((f) => f.value !== "" && !f.scopeOnly);
  const secondaryActive = secondaryOn.length > 0;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const chipText = (f: ToolbarFilter) => (f.kind === "toggle" ? f.label : `${f.label}: ${f.options?.find((o) => o.value === f.value)?.label ?? f.value}`);
  const field = (f: ToolbarFilter) => f.kind === "toggle" ? (
    <ToggleFilter key={f.name} f={f} apply={(on) => go({ [f.name]: on ? "1" : null })} />
  ) : (
    <div key={f.name} className="min-w-[8.5rem]">
      <label htmlFor={`lt-${f.name}`} className="mb-1 block text-[13px] font-medium text-muted-foreground">{f.label}</label>
      {f.kind === "text" || f.kind === "date" ? <TypedFilter f={f} apply={(v) => go({ [f.name]: v || null })} /> : (
        <Select id={`lt-${f.name}`} value={f.value} onChange={(e) => go({ [f.name]: e.target.value || null })}>
          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )}
    </div>
  );
  const active = filters.some((f) => f.value !== "" && !f.scopeOnly) || (search?.value ?? "") !== "";

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
