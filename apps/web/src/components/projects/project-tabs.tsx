"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, ClipboardList, MessageSquare, Package, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeTabHref, type ProjectTabData } from "@/lib/projects/workspace-nav";

export type ProjectTab = ProjectTabData;

const ICONS: Record<string, typeof Calendar> = { Work: ClipboardList, Timeline: Calendar, Discussion: MessageSquare, Equipment: Package, Budget: Wallet };

/**
 * The four primary sections of one project. The old overview address belongs to Work; the sections that were folded into the Plan page
 * (shown as Timeline) keep their old addresses working. Pages reached from "Manage project" light up no tab. On a phone the four are an
 * equal-width row with an icon above each word, so none is ever scrolled out of sight.
 */
export function ProjectTabs({ tabs, base }: { tabs: ProjectTab[]; base: string }) {
  const pathname = usePathname();
  const active = activeTabHref(pathname, base);
  return (
    <nav aria-label="Project sections" className={cn("grid border-b border-border sm:flex sm:gap-1", tabs.length > 4 ? "grid-cols-5" : "grid-cols-4")}>
      {tabs.map((t) => {
        const Icon = ICONS[t.label] ?? ClipboardList;
        const on = active === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "-mb-px flex min-h-[3.5rem] flex-col items-center justify-center gap-1 border-b-[3px] px-1 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex sm:min-h-10 sm:flex-row sm:gap-2 sm:border-b-2 sm:px-4 sm:text-[0.9375rem] sm:font-medium",
              on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{t.label}</span>
            {t.badge ? <span className="hidden rounded-full bg-[hsl(var(--os-info)/0.16)] px-1.5 text-[12px] font-semibold text-[hsl(var(--os-info))] sm:inline">{t.badge}</span> : null}
            {t.badge ? <span className="sr-only sm:hidden">{t.badge} unread</span> : null}
            <span className="relative order-first sm:hidden" aria-hidden>
              <Icon className="h-5 w-5" />
              {t.badge ? <span className="absolute -right-3.5 -top-2 min-w-[1.1rem] rounded-full bg-[hsl(var(--foreground)/0.14)] px-1 text-center text-[11px] font-bold leading-[1.1rem] text-foreground">{t.badge}</span> : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
