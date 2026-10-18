import { CalendarDays, ClipboardCheck, UserRoundX, Users } from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import { noRecordHint as noRecordHintText } from "./attendance-summary";

export function WorkforceSnapshot({
  totalEmployees,
  presentCount,
  leaveCount,
  notRecordedScheduledCount,
  notRecordedRestCount,
  notRecordedUnknownCount,
  leaveRequestsAwaitingDecision,
}: {
  totalEmployees: number;
  presentCount: number;
  leaveCount: number;
  /** No recorded status on a scheduled workday of the employee's own country. */
  notRecordedScheduledCount: number;
  /** No recorded status on the employee's weekly rest day or a public holiday: no attendance expected. */
  notRecordedRestCount: number;
  /** No recorded status and no workweek data for the employee's country, so the day cannot be classified. */
  notRecordedUnknownCount: number;
  leaveRequestsAwaitingDecision: number;
}) {
  const noRecordHint = noRecordHintText({ notRecordedScheduledCount, notRecordedRestCount, notRecordedUnknownCount });

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
      <MetricCard label="Present today" value={presentCount} tone="success" hint="Recorded as present (not live clock status)" href="/attendance" />
      <MetricCard label="On leave today" value={leaveCount} icon={CalendarDays} hint="Leave recorded for today" href="/leave" />
      <MetricCard
        label="No attendance recorded"
        value={notRecordedScheduledCount}
        tone={notRecordedScheduledCount > 0 ? "warning" : "default"}
        icon={UserRoundX}
        hint={noRecordHint}
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
