"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Coming back from a record to the list it was opened from: the same filters, search, view and sort (they live in the address) and the
 * same place in the list (how far it was scrolled). A list page renders <RememberList section="..."/>; the record's "back" link is a
 * <BackLink section="..." fallback="..."/>. The memory lives in sessionStorage (this browser tab only, gone when the tab closes); when
 * there is none, or storage is blocked, the link simply goes to the plain list as it always did, and nothing about the page depends on it.
 */
const key = (section: string, part: "href" | "y" | "restore") => `os-list:${section}:${part}`;
const read = (k: string): string | null => { try { return sessionStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* storage blocked: the back link falls back to the plain list */ } };

/** A stored address is only ever used when it is an address on this same list (never an arbitrary or external one). */
export function safeListHref(stored: string | null, fallback: string): string {
  if (!stored) return fallback;
  const base = fallback.split("?")[0]!;
  return stored === base || stored.startsWith(`${base}?`) ? stored : fallback;
}

export function RememberList({ section }: { section: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString();
  const href = qs ? `${pathname}?${qs}` : pathname;

  // The address (with every filter) is remembered whenever it changes.
  useEffect(() => { write(key(section, "href"), href); }, [section, href]);

  // The scroll position is remembered as the person scrolls, and put back once when they return through a back link.
  useEffect(() => {
    let frame = 0;
    const here = window.location.pathname;
    const onScroll = () => {
      if (frame) return;
      // Once the address is no longer this list, the scroll is the router resetting a new page to the top: not the place to remember.
      frame = requestAnimationFrame(() => { frame = 0; if (window.location.pathname === here) write(key(section, "y"), String(Math.round(window.scrollY))); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // The exact place is also taken at the moment of a click, before any navigation can move the page.
    const onClick = () => write(key(section, "y"), String(Math.round(window.scrollY)));
    document.addEventListener("click", onClick, true);
    const wanted = read(key(section, "restore")) === "1" ? Number(read(key(section, "y"))) : 0;
    write(key(section, "restore"), null);
    // The page may still be rendering, and the router scrolls to the top once the navigation has finished: keep putting the place back for
    // about two and a half seconds, and stop at once when the person scrolls or presses a key themselves.
    let cancelled = false, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { cancelled = true; };
    const inputs = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    if (wanted > 0) inputs.forEach((e) => window.addEventListener(e, stop, { passive: true, once: true }));
    const restore = () => {
      if (cancelled || !(wanted > 0)) return;
      if (Math.abs(window.scrollY - wanted) > 4) window.scrollTo({ top: wanted, behavior: "auto" });
      if (tries++ < 30) timer = setTimeout(restore, 80);
    };
    restore();
    return () => { window.removeEventListener("scroll", onScroll); document.removeEventListener("click", onClick, true); inputs.forEach((e) => window.removeEventListener(e, stop)); cancelled = true; if (frame) cancelAnimationFrame(frame); if (timer) clearTimeout(timer); };
  }, [section]);
  return null;
}

/** "Back to ..." on a record: returns to the list as the person left it. */
export function BackLink({ section, fallback, children, className }: { section: string; fallback: string; children: React.ReactNode; className?: string }) {
  // The remembered address is browser-only: the server and the first client render both use the plain list, then it switches over.
  const href = useSyncExternalStore(() => () => {}, () => safeListHref(read(key(section, "href")), fallback), () => fallback);
  return (
    <Link
      href={href}
      onClick={() => write(key(section, "restore"), "1")}
      className={cn("inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {children}
    </Link>
  );
}
