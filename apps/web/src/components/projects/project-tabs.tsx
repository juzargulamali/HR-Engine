"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { activeTabHref, type ProjectTabData } from "@/lib/projects/workspace-nav";

export type ProjectTab = ProjectTabData;

/**
 * The four primary sections of one project. The overview matches only itself; the sections that were folded into Plan keep
 * their old addresses working and light up Plan. Pages reached from "Manage project" light up no tab.
 */
export function ProjectTabs({ tabs, base }: { tabs: ProjectTab[]; base: string }) {
  const pathname = usePathname();
  const active = activeTabHref(pathname, base);
  return (
    <nav aria-label="Project sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active === t.href ? "page" : undefined}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active === t.href ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.badge ? <span className="rounded-full bg-accent px-1.5 text-[12px] font-semibold text-accent-foreground">{t.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
