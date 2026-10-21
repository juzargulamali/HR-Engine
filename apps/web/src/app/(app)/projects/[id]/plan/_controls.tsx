import Link from "next/link";
import { cn } from "@/lib/utils";

/** A small segmented control made of plain links: choosing a view changes the address only, never a record. */
export function PlanSwitch({ label, options }: { label: string; options: { key: string; label: string; href: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="inline-flex items-center gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5">
      {options.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          scroll={false}
          aria-current={o.current ? "page" : undefined}
          className={cn(
            "inline-flex h-8 items-center rounded-[5px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            o.current ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
