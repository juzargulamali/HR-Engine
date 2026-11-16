import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadError } from "@/components/workspace/states";

export const metadata = { title: "Background processing" };

/**
 * Recovery Leave background processing and database diagnostics. They used to sit above the HR queue; they are about the system, not about an employee, so they live here in
 * Administration (the layout above admits System Administrators only). The HR queue keeps one line when the processor is late. The status function itself still checks the caller's role.
 */
export default async function BackgroundProcessingPage() {
  const supabase = await createClient();
  const { data: s, error } = await supabase.rpc("recovery_scheduler_status");
  if (error || !s) return <LoadError what="the background processing status" retryHref="/admin/background-processing" />;
  const warn = s.stale || s.open_failures > 0 || (s.windows_policy_active && !s.scheduler_ready.ready);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Background processing</h1>
        <p className="text-muted-foreground">Health of the Recovery Leave processor and the database this app is connected to.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Recovery Leave background processing</CardTitle></CardHeader>
        <CardContent>
          <Alert variant={warn ? "warning" : "default"} data-testid="processor-status">
            <p className="mt-1">
              {s.scheduler_ready.ready
                ? "5-minute processor: verified running."
                : `5-minute processor: not verified (${s.scheduler_ready.reasons.join("; ")}). ${
                    s.windows_policy_active ? "Windows and alerts are only processed by the daily safety-net run until it is enabled." : "A Recovery Leave windows policy cannot be activated until it is."
                  }`}{" "}
              {s.last_success_at ? `Last successful run: ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(s.last_success_at))}.` : "It has not run yet."}{" "}
              {s.stale ? "It is overdue, so windows may close and alerts may appear late. " : ""}
              {s.open_failures > 0 ? `${s.open_failures} employee(s) failed on the last run and will be retried. ` : ""}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Work still being finished: {s.work_remaining.open_periods} open working period(s), {s.work_remaining.open_windowed_sessions} open session(s), {s.work_remaining.unresolved_failures} failure(s),{" "}
              {s.work_remaining.unrouted_window_requests} unrouted request(s). The scheduler must stay enabled until all are 0, even after a policy is switched off.
            </p>
          </Alert>
          {s.database_fingerprint ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Database fingerprint: <span className="font-mono" data-testid="database-fingerprint">{s.database_fingerprint}</span>. Compare it with the value the verification SQL prints in the Supabase project you expect (Enginious HR Engine_V2).
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
