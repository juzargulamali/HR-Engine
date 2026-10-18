"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface ProjectTab {
  href: string;
  label: string;
  /** A small count shown beside the label (e.g. unread messages). */
  badge?: string | null;
}

/** Section navigation inside one project. Active state is by path prefix; the first tab (overview) matches only itself. */
export function ProjectTabs({ tabs }: { tabs: ProjectTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Project sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px">
      {tabs.map((t, i) => {
        const active = i === 0 ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.badge ? <span className="rounded-full bg-accent px-1.5 text-[12px] font-semibold text-accent-foreground">{t.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
