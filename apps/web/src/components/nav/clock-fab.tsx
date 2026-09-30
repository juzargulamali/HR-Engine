import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Persistent mobile shortcut to the attendance clock — a plain Server
 * Component (no client state needed, just navigation), fixed at the bottom
 * of the viewport on mobile widths only (md:hidden; the desktop sidebar
 * already carries the same link permanently visible). Rendered once, in
 * AppShell, so it's present on every authenticated page without employees
 * needing to open the nav drawer first.
 */
export function ClockFab({ clockedIn }: { clockedIn: boolean }) {
  return (
    <Link
      href="/attendance-clock"
      aria-label={clockedIn ? "Clocked in — open attendance clock" : "Clock in"}
      className={cn(
        "fixed bottom-5 right-4 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium shadow-lg transition-transform active:scale-95 md:hidden",
        clockedIn ? "bg-success text-success-foreground" : "brand-gradient text-primary-foreground",
      )}
    >
      <Clock className="h-4 w-4" aria-hidden />
      {clockedIn ? "Clocked in" : "Clock In"}
    </Link>
  );
}
