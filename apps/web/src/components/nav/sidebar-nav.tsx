"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { UserMenu } from "./user-menu";
import { NAV_ICONS } from "./nav-icons";
import { COLLAPSE_COOKIE } from "./collapse-cookie";
import { activeModuleId, isLinkActive, type NavModuleData } from "./nav-groups";

const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";
/** The collapsed choice is also kept in a cookie so the server draws the right width on the first paint (no flash of the wide sidebar on every page load). */
const writeCollapseCookie = (collapsed: boolean) => { document.cookie = `${COLLAPSE_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`; };
const hasCollapseCookie = () => document.cookie.split("; ").some((c) => c.startsWith(`${COLLAPSE_COOKIE}=`));

/** The most specific link of a module that matches the path, so only one sub-link is ever marked as the current page. */
function currentSubHref(pathname: string, m: NavModuleData): string | null {
  let best: string | null = null;
  for (const s of m.sections) {
    for (const l of s.links) {
      if (!l.comingSoon && isLinkActive(pathname, l.href) && (best === null || l.href.length > best.length)) best = l.href;
    }
  }
  return best;
}

/**
 * The ENGINIOUS OS product lockup: the original Enginious symbol and lettering with the OS mark (built from the original artwork by
 * scripts/brand/build-os-lockups.mjs). Collapsed, only the symbol. Height is set, width follows, so it is never stretched.
 */
export function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className={cn("flex items-center px-4 py-5", compact ? "justify-center px-2" : "")} aria-label="ENGINIOUS OS, My Day">
      {compact ? (
        <Image src="/brand/enginious-os-symbol-dark.png" alt="" width={255} height={181} priority style={{ height: 26, width: "auto" }} className="flex-none" />
      ) : (
        <Image src="/brand/enginious-os-lockup-dark.png" alt="" width={772} height={124} priority style={{ height: 30, width: "auto" }} className="flex-none" />
      )}
    </Link>
  );
}

/** "Coming soon" is written out, on its own line, so it never truncates a long module name and never relies on colour. */
function ComingSoonRow({ m, collapsed }: { m: NavModuleData; collapsed?: boolean }) {
  const Icon = NAV_ICONS[m.iconKey];
  const row = (
    <div aria-disabled="true" className={cn("flex cursor-default items-center gap-3 rounded-[10px] px-3.5 py-2 text-subtle", collapsed && "justify-center px-0 py-2.5")}>
      <Icon className="h-4 w-4 flex-none" aria-hidden />
      {collapsed ? (
        <span className="sr-only">{m.label}, coming soon</span>
      ) : (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-medium">{m.label}</span>
          <span className="block text-sm">Coming soon</span>
        </span>
      )}
    </div>
  );
  return collapsed ? (
    <Tooltip label={`${m.label} (coming soon)`} side="right">
      {row}
    </Tooltip>
  ) : (
    row
  );
}


/**
 * The pages of one module, shown beside the icon rail while the sidebar is collapsed (on hover, and on keyboard focus: the links come straight after the icon in tab order, so
 * Tab reaches them). Fixed-position so the rail's own scrolling cannot clip it; closes on leaving, on Escape and on choosing a page. Reads the same links as the open sidebar.
 */
function RailFlyout({ m, sub, onNavigate, children }: { m: NavModuleData; sub: string | null; onNavigate?: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => { if (timer.current) clearTimeout(timer.current); const r = wrap.current?.getBoundingClientRect(); if (r) setTop(Math.max(8, Math.min(r.top, window.innerHeight - 120))); setOpen(true); };
  const hide = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 160); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const links = m.sections.flatMap((s) => s.links.filter((l) => !l.secondary));
  return (
    <div ref={wrap} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide(); }} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
      {children}
      {open ? (
        <div role="group" aria-label={`${m.label} pages`} data-testid={`rail-flyout-${m.id}`} style={{ top }} className="os-chrome fixed left-[4.5rem] z-50 w-60 rounded-xl border border-border p-2 shadow-lg">
          <p className="px-2.5 pb-1 pt-1 text-[13px] font-semibold">{m.label}</p>
          <div className="flex flex-col gap-px">
            {links.map((l) => l.comingSoon ? (
              <div key={l.label} aria-disabled="true" className="rounded-md px-2.5 py-1.5 text-subtle"><span className="block text-sm">{l.label}</span><span className="block text-sm">Coming soon</span></div>
            ) : (
              <Link key={l.href} href={l.href} onClick={() => { setOpen(false); onNavigate?.(); }} aria-current={sub === l.href ? "page" : undefined} className="os-nav-sub">{l.label}</Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ModuleNavigation({ modules, collapsed, onNavigate }: { modules: NavModuleData[]; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = activeModuleId(pathname, modules);
  // Explicit open/close choices; a module with no choice is open exactly while it is the one you are in.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  return (
    <nav aria-label="Modules" className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2">
      {modules.map((m) => {
        if (m.comingSoon) return <ComingSoonRow key={m.id} m={m} collapsed={collapsed} />;
        const Icon = NAV_ICONS[m.iconKey];
        const isActive = active === m.id;
        const hasSub = m.sections.length > 0;
        const open = !collapsed && hasSub && (overrides[m.id] ?? isActive);
        const sub = currentSubHref(pathname, m);
        const rowClass = cn("os-nav-link min-w-0 flex-1", collapsed && "justify-center px-0");
        const link = (
          <Link href={m.href} onClick={onNavigate} data-active={isActive ? "true" : undefined} aria-current={isActive && (!hasSub || (!open && sub === m.href)) ? "page" : undefined} className={rowClass}>
            <Icon className="h-[1.15rem] w-[1.15rem] flex-none" aria-hidden />
            {collapsed ? <span className="sr-only">{m.label}</span> : <span className="truncate">{m.label}</span>}
            {m.waiting ? (
              collapsed ? <span className="sr-only">, {m.waiting} waiting for your decision</span> : (
                <span className="ml-auto flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-primary px-1.5 text-[12px] font-semibold leading-none text-primary-foreground">
                  <span aria-hidden>{m.waiting > 99 ? "99+" : m.waiting}</span>
                  <span className="sr-only">{m.waiting} waiting for your decision</span>
                </span>
              )
            ) : null}
          </Link>
        );
        return (
          <div key={m.id}>
            <div className="flex items-center gap-0.5">
              {collapsed ? (
                hasSub ? (
                  <RailFlyout m={m} sub={sub} onNavigate={onNavigate}>{link}</RailFlyout>
                ) : (
                  <Tooltip label={m.label} side="right">
                    {link}
                  </Tooltip>
                )
              ) : (
                link
              )}
              {hasSub && !collapsed ? (
                <button
                  type="button"
                  onClick={() => setOverrides((o) => ({ ...o, [m.id]: !open }))}
                  aria-expanded={open}
                  aria-label={`${open ? "Hide" : "Show"} ${m.label} pages`}
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} aria-hidden />
                </button>
              ) : null}
            </div>
            {open ? (
              <div className="mb-1.5 ml-[1.6rem] mt-1 flex flex-col gap-0.5 border-l border-border pl-3">
                {m.sections.map((s) => (
                  <div key={s.label} className="flex flex-col gap-px">
                    {m.sections.length > 1 && s.label !== m.label ? <p className="px-2.5 pb-0.5 pt-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-subtle">{s.label}</p> : null}
                    {s.links.filter((l) => !l.secondary).map((l) => {
                      if (l.comingSoon) {
                        return (
                          <div key={l.label} aria-disabled="true" className="rounded-md px-2.5 py-1.5 text-subtle">
                            <span className="block text-sm">{l.label}</span>
                            <span className="block text-sm">Coming soon</span>
                          </div>
                        );
                      }
                      const subActive = sub === l.href;
                      return (
                        <Link
                          key={l.href}
                          href={l.href}
                          onClick={onNavigate}
                          aria-current={subActive ? "page" : undefined}
                          className="os-nav-sub"
                        >
                          {l.label}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function DesktopSidebar({
  modules,
  fullName,
  email,
  roleLabels,
  signOutSlot,
  defaultCollapsed = false,
}: {
  modules: NavModuleData[];
  fullName: string;
  email: string | null;
  roleLabels: string[];
  signOutSlot: React.ReactNode;
  /** What the server read from the cookie, so the first paint already has the person's width. */
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    // Someone who collapsed the sidebar before the cookie existed: adopt their saved choice once and write the cookie, so the next load is right from the start.
    Promise.resolve().then(() => {
      try {
        if (!hasCollapseCookie()) {
          const saved = window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
          if (saved) setCollapsed(true);
          writeCollapseCookie(saved);
        }
      } catch {
        // ignore
      } finally {
        setAnimate(true);
      }
    });
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      writeCollapseCookie(next);
    } catch {
      // ignore
    }
  }

  return (
    <aside
      aria-label="ENGINIOUS OS modules"
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "os-chrome os-sidebar sticky top-0 hidden h-screen flex-none flex-col lg:flex",
        animate ? "transition-[width] duration-200" : "",
        collapsed ? "w-[4.5rem]" : "w-[16rem]",
      )}
    >
      <BrandMark compact={collapsed} />
      <ModuleNavigation modules={modules} collapsed={collapsed} />
      <div className="border-t border-border p-2">
        <UserMenu fullName={fullName} email={email} roleLabels={roleLabels} signOutSlot={signOutSlot} collapsed={collapsed} side="top" />
      </div>
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={collapsed}
        className="flex items-center justify-center gap-2 border-t border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
        {collapsed ? null : "Collapse"}
      </button>
    </aside>
  );
}
