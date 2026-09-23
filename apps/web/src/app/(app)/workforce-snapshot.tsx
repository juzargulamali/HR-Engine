import { CalendarDays, ClipboardCheck, UserRoundX, Users } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";

export function WorkforceSnapshot({
  totalEmployees,
  presentCount,
  leaveCount,
  notRecordedCount,
  leaveRequestsAwaitingDecision,
}: {
  totalEmployees: number;
  presentCount: number;
  leaveCount: number;
  notRecordedCount: number;
  leaveRequestsAwaitingDecision: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <MetricCard
        label="Total employees"
        value={totalEmployees}
        hint="Across every company you can see"
        icon={Users}
        href="/employees"
        className="lg:col-span-2"
      />
      <MetricCard label="Present today" value={presentCount} tone="success" href="/attendance" />
      <MetricCard label="On leave today" value={leaveCount} icon={CalendarDays} href="/leave" />
      <MetricCard
        label="Missing record"
        value={notRecordedCount}
        tone={notRecordedCount > 0 ? "warning" : "default"}
        icon={UserRoundX}
        href="/attendance"
      />
      <MetricCard
        label="Leave requests in review"
        value={leaveRequestsAwaitingDecision}
        // Company-wide count of every leave request not yet decided by
        // anyone — deliberately NOT labeled "pending approvals" and
        // deliberately not linked to /approvals, which only ever shows
        // items assigned to the viewer. The two numbers are both real but
        // answer different questions, and showing them under the same
        // label (or sending this card to a page scoped to something else
        // entirely) is exactly the confusion this metric used to cause.
        hint="Company-wide, any approver — not just items waiting on you"
        tone={leaveRequestsAwaitingDecision > 0 ? "warning" : "default"}
        icon={ClipboardCheck}
      />
    </div>
  );
}
