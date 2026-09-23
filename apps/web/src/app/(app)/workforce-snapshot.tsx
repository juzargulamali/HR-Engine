import { CalendarDays, ClipboardCheck, UserRoundX, Users } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";

export function WorkforceSnapshot({
  totalEmployees,
  presentCount,
  leaveCount,
  notRecordedCount,
  pendingLeaveApprovals,
}: {
  totalEmployees: number;
  presentCount: number;
  leaveCount: number;
  notRecordedCount: number;
  pendingLeaveApprovals: number;
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
        label="Pending approvals"
        value={pendingLeaveApprovals}
        tone={pendingLeaveApprovals > 0 ? "warning" : "default"}
        icon={ClipboardCheck}
        href="/approvals"
      />
    </div>
  );
}
