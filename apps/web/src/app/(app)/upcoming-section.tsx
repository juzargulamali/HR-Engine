import Link from "next/link";
import { CalendarDays, Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export function UpcomingSection({
  holidays,
  onLeaveToday,
}: {
  holidays: { name: string; holiday_date: string; countryCode: string }[];
  onLeaveToday: { id: string; name: string; companyName: string }[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Upcoming holidays</CardTitle>
        </CardHeader>
        <CardContent>
          {holidays.length === 0 ? (
            <EmptyState dense icon={Landmark} title="No holidays in the next 30 days." />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {holidays.map((h) => (
                <li key={`${h.countryCode}-${h.holiday_date}-${h.name}`} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
                    {h.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{h.holiday_date}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>On leave today</CardTitle>
        </CardHeader>
        <CardContent>
          {onLeaveToday.length === 0 ? (
            <EmptyState dense icon={CalendarDays} title="Everyone's in today." description="No one is recorded on leave for today." />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {onLeaveToday.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/employees/${e.id}`} className="hover:underline">
                    {e.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">{e.companyName}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
