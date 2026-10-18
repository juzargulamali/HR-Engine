"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface SalesTab {
  href: string;
  label: string;
}

/** Secondary navigation inside Sales & CRM. Active state is by path prefix. */
export function SalesTabs({ tabs }: { tabs: SalesTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sales sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border pb-px">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
