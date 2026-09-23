"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { Drawer } from "@/components/ui/drawer";
import { UserMenu } from "./user-menu";

export type NavLink = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { label: string; links: NavLink[] };

const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className={cn("brand-grid-tight flex items-center gap-2.5 px-4 py-4", compact && "justify-center px-2")}>
      <Image src="/brand/enginious-icon.png" alt="" width={28} height={28} priority className="flex-none" />
      {compact ? null : (
        <div className="min-w-0 leading-tight">
          <div className="truncate font-heading text-sm font-bold tracking-tight">ENGINIOUS</div>
          <div className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">HR Engine</div>
        </div>
      )}
    </Link>
  );
}

function NavLinks({ groups, collapsed, onNavigate }: { groups: NavGroup[]; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-3">
      {groups.map((group) => {
        const groupCollapsed = !collapsed && collapsedGroups.has(group.label);
        return (
          <div key={group.label}>
            {collapsed ? (
              <div className="mb-1 h-px bg-border/70" />
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                aria-expanded={!groupCollapsed}
                className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-left transition-colors hover:bg-secondary/50"
              >
                <span className="h-3 w-0.5 flex-none rounded-full brand-gradient" aria-hidden />
                <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{group.label}</span>
                <ChevronDown
                  className={cn("h-3.5 w-3.5 flex-none text-muted-foreground transition-transform duration-150", groupCollapsed && "-rotate-90")}
                  aria-hidden
                />
              </button>
            )}
            {groupCollapsed ? null : (
              <div className="flex flex-col gap-0.5">
                {group.links.map((link) => {
                  const active = isActive(pathname, link.href);
                  const Icon = link.icon;
                  const linkEl = (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        collapsed && "justify-center px-0 py-2.5",
                        active ? "bg-accent/10 text-foreground" : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                      )}
                    >
                      {active ? (
                        <span
                          className={cn("absolute rounded-full brand-gradient", collapsed ? "inset-y-1.5 left-0.5 w-[3px]" : "inset-y-1 left-0 w-[3px]")}
                          aria-hidden
                        />
                      ) : null}
                      <Icon className="h-4 w-4 flex-none" aria-hidden />
                      {collapsed ? null : <span className="truncate">{link.label}</span>}
                    </Link>
                  );
                  return collapsed ? (
                    <Tooltip key={link.href} label={link.label} side="right">
                      {linkEl}
                    </Tooltip>
                  ) : (
                    linkEl
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function SidebarNav({
  groups,
  fullName,
  email,
  roleLabels,
  signOutSlot,
}: {
  groups: NavGroup[];
  fullName: string;
  email: string | null;
  roleLabels: string[];
  signOutSlot: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [collapseReady, setCollapseReady] = useState(false);

  useEffect(() => {
    // Deferred a tick rather than calling setState synchronously in the
    // effect body (matches the same pattern in theme-toggle.tsx).
    Promise.resolve().then(() => {
      try {
        setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1");
      } catch {
        // ignore
      } finally {
        setCollapseReady(true);
      }
    });
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/brand/enginious-icon.png" alt="" width={26} height={26} priority />
          <span className="font-heading text-sm font-bold tracking-tight">ENGINIOUS HR</span>
        </Link>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-secondary/70"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden flex-none flex-col border-r border-border bg-card transition-[width] duration-200 md:flex",
          collapseReady ? "" : "duration-0",
          collapsed ? "w-[4.5rem]" : "w-64",
        )}
      >
        <BrandMark compact={collapsed} />
        <NavLinks groups={groups} collapsed={collapsed} />
        <div className="border-t border-border p-2">
          <UserMenu fullName={fullName} email={email} roleLabels={roleLabels} signOutSlot={signOutSlot} collapsed={collapsed} side="top" />
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex items-center justify-center gap-2 border-t border-border py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden /> : <PanelLeftClose className="h-4 w-4" aria-hidden />}
          {collapsed ? null : "Collapse"}
        </button>
      </aside>

      {/* Mobile drawer */}
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} title="Navigation">
        <NavLinks groups={groups} onNavigate={() => setMobileOpen(false)} />
        <div className="border-t border-border p-2">
          <UserMenu fullName={fullName} email={email} roleLabels={roleLabels} signOutSlot={signOutSlot} side="top" />
        </div>
      </Drawer>
    </>
  );
}
