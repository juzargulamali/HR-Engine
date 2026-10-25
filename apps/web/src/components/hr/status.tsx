import { OsBadge, type OsTone } from "@/components/os/pills";

const EMPLOYMENT_TONE: Record<string, OsTone> = { active: "green", on_leave: "blue", suspended: "amber", terminated: "quiet" };

/** An employee's employment status in words, with a colour cue: the same colour for the same status on every screen. */
export function EmploymentStatusBadge({ status }: { status: string }) {
  return <OsBadge tone={EMPLOYMENT_TONE[status] ?? "neutral"} dot={status !== "terminated"} className="whitespace-nowrap">{status.replace(/_/g, " ")}</OsBadge>;
}
