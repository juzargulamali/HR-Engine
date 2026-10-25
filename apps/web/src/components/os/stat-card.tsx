import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Edge = "cyan" | "amber" | "blue" | "muted";
const ICON_TONE: Record<Edge, string> = { cyan: "text-accent", amber: "text-[hsl(var(--os-amber))]", blue: "text-[hsl(var(--os-info))]", muted: "text-muted-foreground" };

/**
 * A summary card: a coloured edge, an icon, a number and a label; the whole card is a link to where the number comes from, so it can be
 * a shortcut to a filtered list. `active` marks the card whose filter is on. The number is always counted from real records by the caller.
 */
export function OsStatCard({ href, label, value, hint, icon: Icon, edge = "cyan", active, compact = true }: { href: string; label: string; value: React.ReactNode; hint?: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; edge?: Edge; active?: boolean; compact?: boolean }) {
  return (
    <Link
      href={href} scroll={false} aria-current={active ? "true" : undefined} data-edge={edge === "cyan" ? undefined : edge}
      className={cn("os-card os-stat focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", compact && "!flex-col !items-start !gap-0 !px-3.5 !py-2.5 sm:!flex-row sm:!items-center sm:!gap-3.5 sm:!px-4 sm:!py-4")}
    >
      <Icon className={cn("hidden h-6 w-6 flex-none sm:block", ICON_TONE[edge])} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-heading text-2xl font-semibold leading-none tabular-nums">{value}</span>
        <span className="mt-1 block text-[13px] leading-tight text-muted-foreground sm:text-sm">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12px] leading-tight text-muted-foreground">{hint}</span> : null}
      </span>
      <ChevronRight className="hidden h-4 w-4 flex-none text-muted-foreground sm:block" aria-hidden />
    </Link>
  );
}
