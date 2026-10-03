import { cn } from "@/lib/utils";

export type ClockStatusValue = "clocked_in" | "clocked_out" | "not_started";

const CONFIG: Record<ClockStatusValue, { label: string; dot: string }> = {
  clocked_in: { label: "Clocked in", dot: "bg-success" },
  clocked_out: { label: "Clocked out", dot: "bg-destructive" },
  not_started: { label: "Not started", dot: "bg-muted-foreground/50" },
};

/**
 * The clock state shown identically on the HR register and the dashboard.
 * Never colour-only: every state carries its own text next to the dot, so it
 * reads correctly for colour-blind users and in grayscale. (Deliberately not
 * "Online/Offline" — this is about clock sessions, not connectivity.)
 */
export function ClockStatus({ status, className }: { status: ClockStatusValue; className?: string }) {
  const c = CONFIG[status];
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm font-medium", className)} data-clock-status={status}>
      <span aria-hidden className={cn("inline-block h-2.5 w-2.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}
