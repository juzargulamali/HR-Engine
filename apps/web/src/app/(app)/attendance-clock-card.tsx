import Link from "next/link";
import { Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";

/**
 * The dashboard's own prominent attendance-clock summary — every employee
 * should be able to clock in/out without hunting through menus (see
 * apps/web/src/app/(app)/attendance-clock/page.tsx, where the actual
 * Clock In/Out controls live). This card only ever shows a status + link;
 * it never duplicates the clock logic itself.
 */
export async function AttendanceClockCard({ employeeId }: { employeeId: string }) {
  const supabase = await createClient();
  const { data: openSession } = await supabase
    .from("attendance_sessions")
    .select("clock_in_at")
    .eq("employee_id", employeeId)
    .eq("status", "open")
    .maybeSingle();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" aria-hidden />
          Attendance clock
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        {openSession ? (
          <p className="text-sm">
            <Badge variant="success" className="mr-2">
              Clocked in
            </Badge>
            since {new Date(openSession.clock_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        ) : (
          <p className="text-sm">
            <Badge variant="secondary" className="mr-2">
              Not clocked in
            </Badge>
          </p>
        )}
        <Link href="/attendance-clock" className={cn(buttonVariants({ variant: openSession ? "outline" : "default", size: "sm" }))}>
          {openSession ? "Clock Out / switch mode" : "Clock In"}
        </Link>
      </CardContent>
    </Card>
  );
}
