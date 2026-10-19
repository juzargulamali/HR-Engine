"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, X } from "lucide-react";
import { confirmDiscard } from "./unsaved";

/**
 * Record details beside the list. The record is chosen by an `open` parameter in the URL, so the list behind it (filters, sort,
 * scroll position) is exactly as it was, the browser's Back button closes the panel, and the address can be shared. The record's
 * own full page stays available through "Open full page". Closing, or opening another record, first asks about unsaved edits.
 *
 * On a phone it takes the whole screen (a narrow drawer would be cramped); from the large breakpoint up it is a column on the right.
 */
export function SidePanel({ title, subtitle, closeHref, fullPageHref, children }: { title: string; subtitle?: string; closeHref: string; fullPageHref?: string; children: React.ReactNode }) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const close = () => {
    if (!confirmDiscard()) return;
    router.push(closeHref, { scroll: false });
  };

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => {
      const el = opener.current;
      if (el && el.isConnected) el.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dialog opened from the panel (hold, close as won…) handles its own Escape.
      if (document.querySelector("dialog[open]")) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `close` only reads the router and the module-level store
  }, [closeHref]);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={title}
      className="fixed inset-0 z-[45] flex flex-col bg-background lg:inset-y-0 lg:left-auto lg:right-0 lg:top-[53px] lg:w-[min(38rem,94vw)] lg:border-l lg:border-border lg:shadow-[var(--shadow-pop)]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border bg-chrome px-4 py-3">
        <div className="min-w-0">
          {subtitle ? <p className="truncate text-[13px] text-muted-foreground">{subtitle}</p> : null}
          <h2 ref={headingRef} tabIndex={-1} style={{ outline: "none" }} className="break-words font-heading text-base font-semibold leading-snug">{title}</h2>
        </div>
        <div className="flex flex-none items-center gap-1">
          {fullPageHref ? (
            <Link href={fullPageHref} onClick={(e) => { if (!confirmDiscard()) e.preventDefault(); }} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Full page
            </Link>
          ) : null}
          <button type="button" onClick={close} aria-label="Close details" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-24 lg:pb-6">{children}</div>
    </aside>
  );
}
