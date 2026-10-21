import Link from "next/link";
import { LayoutGrid, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewMode } from "./url-state";

/**
 * Table | Board: two views of the same records. Plain links (no JavaScript needed), so the filters in the address carry over
 * and Back returns to the other view. The page decides which view it is showing; this only draws the switch.
 */
export function ViewSwitch({ current, tableHref, boardHref, boardLabel = "Board" }: { current: ViewMode; tableHref: string; boardHref: string; boardLabel?: string }) {
  const item = (mode: ViewMode, href: string, label: string, Icon: typeof Table2) => (
    <Link
      key={mode}
      href={href}
      scroll={false}
      aria-current={current === mode ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        current === mode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
    </Link>
  );
  return (
    <nav aria-label="View" className="inline-flex items-center gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5">
      {item("table", tableHref, "Table", Table2)}
      {item("board", boardHref, boardLabel, LayoutGrid)}
    </nav>
  );
}
