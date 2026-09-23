"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavGroupData } from "./nav-groups";
import { NAV_ICONS } from "./nav-icons";

/**
 * Ctrl/Cmd+K navigation search over the nav links the current user can
 * actually see (built from the same `groups` AppShell already computes
 * with permission filtering, never a separate unfiltered list) — a real,
 * working "jump to a page" tool, not a stub. Not a full omni-search over
 * HR data; that's a larger, separate feature.
 */
export function CommandPalette({ groups }: { groups: NavGroupData[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const flatLinks = useMemo(() => groups.flatMap((g) => g.links.map((l) => ({ ...l, group: g.label }))), [groups]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flatLinks;
    return flatLinks.filter((l) => l.label.toLowerCase().includes(q) || l.group.toLowerCase().includes(q));
  }, [flatLinks, query]);

  function openPalette() {
    setQuery("");
    setOpen(true);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) setQuery("");
          return !v;
        });
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input and lock scroll while open — a DOM/external-system
  // side effect (not a setState call), so this one belongs in an effect.
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => inputRef.current?.focus());
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        cancelAnimationFrame(raf);
        document.body.style.overflow = previousOverflow;
      };
    }
  }, [open]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
      >
        <Search className="h-4 w-4 flex-none" aria-hidden />
        <span className="flex-1 truncate text-left">Search or jump to…</span>
        <kbd className="hidden flex-none rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium sm:inline">⌘K</kbd>
      </button>

      <div
        className={cn(
          "fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh] transition-opacity duration-150",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!open}
      >
        <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search navigation"
          className={cn(
            "relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl transition-all duration-150",
            open ? "translate-y-0 scale-100" : "-translate-y-2 scale-95",
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a page name…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Search navigation"
            />
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matching page.</p>
            ) : (
              results.map((l) => (
                <button
                  key={l.href}
                  type="button"
                  onClick={() => go(l.href)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/70 focus-visible:bg-secondary/70 focus-visible:outline-none"
                >
                  <span className="flex items-center gap-2">
                    {(() => {
                      const Icon = NAV_ICONS[l.iconKey];
                      return <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />;
                    })()}
                    {l.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{l.group}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
