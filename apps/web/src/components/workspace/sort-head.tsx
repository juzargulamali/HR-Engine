import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortDir } from "./url-state";

/** A column heading that sorts the list when clicked. The state is announced (aria-sort) and shown with an arrow, never by colour alone. */
export function SortHead({ label, href, active, dir, className }: { label: string; href: string; active: boolean; dir: SortDir; className?: string }) {
  return (
    <TableHead scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <Link href={href} scroll={false} className={cn("inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active && "text-foreground")}>
        {label}
        {active ? (dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />) : null}
      </Link>
    </TableHead>
  );
}
