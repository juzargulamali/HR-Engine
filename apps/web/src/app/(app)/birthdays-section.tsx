import Link from "next/link";
import { daysUntilNextBirthday } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const WINDOW_DAYS = 3;

function dayLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/**
 * HR Admin/CEO/CTO-only dashboard box (gated by the caller via
 * canViewHrAlerts, same as the Alerts tile) — every employee with a
 * date_of_birth on file whose next birthday falls within the next
 * WINDOW_DAYS days, across every company that role covers (no explicit
 * company filter, same "RLS alone decides" convention as alerts/page.tsx).
 * Renders nothing at all when there's nothing upcoming, rather than an
 * empty-state card — unlike the dedicated Alerts page (which people
 * deliberately visit to check status), this sits on the home dashboard
 * every day, so it should stay out of the way on the common case.
 */
export async function BirthdaysSection() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: employees } = await supabase
    .from("employees")
    .select("id, first_name, last_name, date_of_birth")
    .is("deleted_at", null)
    .not("date_of_birth", "is", null);

  const upcoming = (employees ?? [])
    .map((e) => ({ ...e, daysUntil: daysUntilNextBirthday(e.date_of_birth!, today) }))
    .filter((e) => e.daysUntil <= WINDOW_DAYS)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  if (upcoming.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming birthdays</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {upcoming.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
            <Link href={`/employees/${e.id}`} className="hover:underline">
              {e.first_name} {e.last_name}
            </Link>
            <Badge variant={e.daysUntil === 0 ? "brand" : "secondary"}>{dayLabel(e.daysUntil)}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
