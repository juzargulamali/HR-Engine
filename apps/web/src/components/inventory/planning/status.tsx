import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { requestStatusLabel, type Tone } from "@/lib/inventory/planning";

const STATUS_TONE: Record<string, string> = {
  submitted: "border-[hsl(var(--os-info)/0.4)] bg-[hsl(var(--os-info)/0.1)] text-[hsl(var(--os-info))]",
  in_progress: "border-[hsl(var(--os-amber)/0.4)] bg-[hsl(var(--os-amber)/0.1)] text-[hsl(var(--os-amber))]",
  fulfilled: "border-[hsl(var(--os-green)/0.4)] bg-[hsl(var(--os-green)/0.1)] text-[hsl(var(--os-green))]",
  closed: "text-muted-foreground",
  cancelled: "border-border bg-secondary text-muted-foreground",
};

/** A request's status in plain words (REQUEST_STATUS_WORDS), never colour alone. */
export function RequestStatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap", STATUS_TONE[status])}>{requestStatusLabel(status)}</Badge>;
}

export const TONE_TEXT: Record<Tone | "info", string> = {
  good: "text-[hsl(var(--os-green))]",
  warn: "text-[hsl(var(--os-amber))]",
  bad: "text-destructive",
  info: "text-[hsl(var(--os-info))]",
  plain: "text-foreground",
};

export const TONE_BADGE: Record<Tone | "info", string> = {
  good: "border-[hsl(var(--os-green)/0.4)] bg-[hsl(var(--os-green)/0.1)] text-[hsl(var(--os-green))]",
  warn: "border-[hsl(var(--os-amber)/0.4)] bg-[hsl(var(--os-amber)/0.1)] text-[hsl(var(--os-amber))]",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-[hsl(var(--os-info)/0.4)] bg-[hsl(var(--os-info)/0.1)] text-[hsl(var(--os-info))]",
  plain: "text-muted-foreground",
};
