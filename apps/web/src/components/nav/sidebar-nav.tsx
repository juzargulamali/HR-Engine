"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { cn } from "@/lib/utils";

export type NavLink = { href: string; label: string };
export type NavGroup = { label: string; links: NavLink[] };

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="mb-1.5 flex items-center gap-2 px-3">
            <span className="h-3 w-0.5 rounded-full brand-gradient" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            {group.links.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onNavigate}
                  className={cn(
                    "relative flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent/10 text-foreground"
                      : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                  )}
                >
                  {active ? <span className="absolute inset-y-1 left-0 w-[3px] rounded-full brand-gradient" aria-hidden /> : null}
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function SidebarNav({
  groups,
  userSummary,
  signOutButton,
}: {
  groups: NavGroup[];
  userSummary: React.ReactNode;
  signOutButton: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

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
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground"
        >
          <span className="sr-only">Toggle navigation</span>
          {open ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M2 2L16 16M16 2L2 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <path d="M2 4.5H16M2 9H16M2 13.5H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>

      {/* Desktop sidebar */}
      <aside className="brand-grid hidden w-64 flex-none flex-col border-r border-border bg-card md:flex">
        <NavLinks groups={groups} />
      </aside>

      {/* Mobile slide-down panel */}
      {open ? (
        <div className="brand-grid flex flex-col border-b border-border bg-card md:hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            {userSummary}
            {signOutButton}
          </div>
          <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}
