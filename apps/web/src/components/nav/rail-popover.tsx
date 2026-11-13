"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { NavModuleData } from "./nav-groups";

/**
 * Popovers for the collapsed (icon-only) sidebar rail: a label tooltip and a module's pages ("flyout").
 *
 * Why a portal: the rail's own list scrolls (`overflow-y: auto`), which clips anything drawn outside it, and the sidebar is a sticky element that forms its own stacking context
 * below the page's sticky headers, so a popover drawn inside it sat behind the project header and tabs. These render into `document.body` with fixed positions taken from the
 * icon, above ordinary page content (z-60) and below a modal dialog (the browser's top layer is always above any z-index). They are placed from the icon's rectangle just right of the
 * rail, kept inside the viewport, and the flyout scrolls when it is taller than the space.
 */
const GAP = 6;
const Z = "z-[60]";

/** Puts a popover beside its anchor icon: just right of the rail, level with the icon (tooltip: centred on it), moved up if it would run past the bottom. */
function position(pop: HTMLElement | null, anchor: HTMLElement | null, centre: boolean) {
  if (!pop || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const rail = anchor.closest("aside")?.getBoundingClientRect();
  const h = Math.min(pop.getBoundingClientRect().height, window.innerHeight - 16);
  const wanted = centre ? r.top + r.height / 2 - h / 2 : r.top;
  pop.style.left = `${(rail?.right ?? r.right) + GAP}px`;
  pop.style.top = `${Math.max(8, Math.min(wanted, window.innerHeight - h - 8))}px`;
}

function usePopover(centre: boolean) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quiet = useRef(false);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const show = useCallback(() => { clear(); setOpen(true); }, []);
  const hide = useCallback((delay = 160) => { clear(); timer.current = setTimeout(() => setOpen(false), delay); }, []);
  const close = useCallback(() => { clear(); setOpen(false); }, []);
  useEffect(() => clear, []);
  // A callback ref: it positions the popover the moment it is attached, with no extra render.
  const setPop = useCallback((el: HTMLDivElement | null) => { popRef.current = el; position(el, anchorRef.current, centre); }, [centre]);
  // Follow the icon if the page or the rail scrolls, or the window changes, while it is open.
  useEffect(() => {
    if (!open) return;
    const update = () => position(popRef.current, anchorRef.current, centre);
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, centre]);
  const inside = (n: Node | null) => !!n && (!!anchorRef.current?.contains(n) || !!popRef.current?.contains(n));
  /** Focus arriving on the icon opens the popover, except when we ourselves just gave focus back after closing it. */
  const onFocusShow = () => { if (quiet.current) return; show(); };
  const restoreFocus = (el: HTMLElement | null | undefined) => { quiet.current = true; el?.focus(); setTimeout(() => { quiet.current = false; }, 0); };
  return { open, anchorRef, popRef, setPop, show, hide, close, inside, onFocusShow, restoreFocus };
}

/** A label shown beside an icon on hover or keyboard focus, drawn outside the rail so it is never clipped. */
export function RailTip({ label, children }: { label: string; children: React.ReactNode }) {
  const { open, anchorRef, setPop, show, hide, close, inside, onFocusShow } = usePopover(true);
  return (
    <div ref={anchorRef} className="w-full" onMouseEnter={show} onMouseLeave={() => hide(0)} onFocus={onFocusShow} onBlur={(e) => { if (!inside(e.relatedTarget as Node | null)) hide(0); }} onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
      {children}
      {open && typeof document !== "undefined" ? createPortal(
        <div ref={setPop} role="tooltip" className={`pointer-events-none fixed ${Z} whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-foreground shadow-lg`}>{label}</div>,
        document.body,
      ) : null}
    </div>
  );
}

/**
 * A module's pages beside its icon while the sidebar is collapsed. Opens on hover and on focus; the pointer can cross the small gap into it (a short close delay, cancelled on entering).
 * Keyboard: ArrowRight or ArrowDown from the icon moves into the pages; ArrowUp / ArrowDown / Home / End move between them; Escape or ArrowLeft closes it and gives focus back to
 * the icon; Tab leaves it and returns to the icon so the next Tab goes on to the next icon. Choosing a page closes it.
 */
export function RailFlyout({ m, sub, onNavigate, children }: { m: NavModuleData; sub: string | null; onNavigate?: () => void; children: React.ReactNode }) {
  const { open, anchorRef, popRef, setPop, show, hide, close, inside, onFocusShow, restoreFocus } = usePopover(false);
  const links = m.sections.flatMap((s) => s.links.filter((l) => !l.secondary));
  const items = () => Array.from(popRef.current?.querySelectorAll<HTMLElement>("a[href]") ?? []);
  const back = () => { close(); restoreFocus(anchorRef.current?.querySelector<HTMLElement>("a")); };
  return (
    <div ref={anchorRef} className="w-full" onMouseEnter={show} onMouseLeave={() => hide()} onFocus={onFocusShow}
      onBlur={(e) => { if (!inside(e.relatedTarget as Node | null)) hide(0); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { if (open) { e.preventDefault(); back(); } return; }
        if ((e.key === "ArrowRight" || e.key === "ArrowDown") && anchorRef.current?.contains(e.target as Node)) { e.preventDefault(); show(); requestAnimationFrame(() => items()[0]?.focus()); }
      }}>
      {children}
      {open && typeof document !== "undefined" ? createPortal(
        <div ref={setPop} role="group" aria-label={`${m.label} pages`} data-testid={`rail-flyout-${m.id}`} style={{ maxHeight: "calc(100vh - 16px)" }}
          className={`os-chrome fixed ${Z} w-60 overflow-y-auto overscroll-contain rounded-xl border border-border p-2 shadow-xl`}
          onKeyDown={(e) => {
            const els = items(); const i = els.indexOf(document.activeElement as HTMLElement);
            if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
            else if (e.key === "Home") { e.preventDefault(); els[0]?.focus(); }
            else if (e.key === "End") { e.preventDefault(); els[els.length - 1]?.focus(); }
            else if (e.key === "Escape" || e.key === "ArrowLeft" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); back(); }
          }}>
          <p className="px-2.5 pb-1 pt-1 text-[13px] font-semibold">{m.label}</p>
          <div className="flex flex-col gap-px">
            {links.map((l) => l.comingSoon ? (
              <div key={l.label} aria-disabled="true" className="rounded-md px-2.5 py-1.5 text-subtle"><span className="block text-sm">{l.label}</span><span className="block text-sm">Coming soon</span></div>
            ) : (
              <Link key={l.href} href={l.href} onClick={() => { close(); onNavigate?.(); }} aria-current={sub === l.href ? "page" : undefined} className="os-nav-sub">{l.label}</Link>
            ))}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
