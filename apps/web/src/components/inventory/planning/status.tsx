import { OsBadge, type OsTone } from "@/components/os/pills";
import { requestStatusLabel, type Tone } from "@/lib/inventory/planning";

const STATUS_TONE: Record<string, OsTone> = { submitted: "blue", in_progress: "amber", fulfilled: "green", closed: "quiet", cancelled: "quiet" };

/** A request's status in plain words (REQUEST_STATUS_WORDS), never colour alone. */
export function RequestStatusBadge({ status }: { status: string }) {
  return <OsBadge tone={STATUS_TONE[status] ?? "neutral"} dot={status !== "closed" && status !== "cancelled"} className="whitespace-nowrap">{requestStatusLabel(status)}</OsBadge>;
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
