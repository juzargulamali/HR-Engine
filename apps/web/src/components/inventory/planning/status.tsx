import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { requestStatusLabel, type Tone } from "@/lib/inventory/planning";

const STATUS_TONE: Record<string, string> = {
  submitted: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  in_progress: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  fulfilled: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  closed: "text-muted-foreground",
  cancelled: "border-border bg-secondary text-muted-foreground",
};

/** A request's status in plain words (REQUEST_STATUS_WORDS), never colour alone. */
export function RequestStatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap", STATUS_TONE[status])}>{requestStatusLabel(status)}</Badge>;
}

export const TONE_TEXT: Record<Tone | "info", string> = {
  good: "text-emerald-800 dark:text-emerald-300",
  warn: "text-amber-800 dark:text-amber-300",
  bad: "text-destructive",
  info: "text-sky-800 dark:text-sky-300",
  plain: "text-foreground",
};

export const TONE_BADGE: Record<Tone | "info", string> = {
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  plain: "text-muted-foreground",
};
