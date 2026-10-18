"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface DetailTab {
  id: string;
  label: string;
  /** Server-rendered content for this tab. All tabs stay mounted (hidden when inactive) so a half-filled form survives switching. */
  content: React.ReactNode;
}

/** Accessible tabs (arrow keys, Home/End) over server-rendered panels. */
export function DetailTabs({ tabs, initial }: { tabs: DetailTab[]; initial: string }) {
  const base = useId();
  const [active, setActive] = useState(tabs.some((t) => t.id === initial) ? initial : (tabs[0]?.id ?? ""));
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusTab = (id: string | undefined) => {
    if (!id) return;
    setActive(id);
    refs.current[id]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight") { e.preventDefault(); focusTab(tabs[(index + 1) % tabs.length]?.id); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); focusTab(tabs[(index - 1 + tabs.length) % tabs.length]?.id); }
    else if (e.key === "Home") { e.preventDefault(); focusTab(tabs[0]?.id); }
    else if (e.key === "End") { e.preventDefault(); focusTab(tabs[tabs.length - 1]?.id); }
  };
  return (
    <div>
      <div role="tablist" aria-label="Opportunity sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} hidden={active !== t.id} className="mt-5">
          {t.content}
        </div>
      ))}
    </div>
  );
}
