import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { LeaveRequestForm } from "./leave-request-form";

export default async function NewLeaveRequestPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  if (!session.employeeId) {
    return (
      <Alert variant="destructive">No employee record is linked to your account — you can&apos;t submit a leave request.</Alert>
    );
  }

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("country_code")
    .eq("id", session.employeeId)
    .single();

  // Leave types come from the active leave_rules policy for the employee's
  // country (docs/09-extending-the-system.md) — nothing here is hard-coded
  // per country. If HR Admin hasn't activated one yet, the form falls back
  // to a free-text leave type code rather than blocking submission.
  let leaveTypes: { code: string; name: string }[] = [];
  if (employee) {
    const { data: activePolicy } = await supabase
      .from("policy_versions")
      .select("id")
      .eq("country_code", employee.country_code)
      .eq("policy_type", "leave_rules")
      .eq("status", "active")
      .maybeSingle();

    if (activePolicy) {
      const { data: rows } = await supabase
        .from("policy_leave_types")
        .select("leave_type_code, name")
        .eq("policy_version_id", activePolicy.id);
      leaveTypes = (rows ?? []).map((r) => ({ code: r.leave_type_code, name: r.name }));
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Request leave</CardTitle>
      </CardHeader>
      <CardContent>
        {leaveTypes.length === 0 ? (
          <Alert className="mb-4">
            No leave types are configured for your country yet — enter one manually below. Ask HR Admin to activate a
            leave policy so this becomes a dropdown.
          </Alert>
        ) : null}
        <LeaveRequestForm leaveTypes={leaveTypes} />
      </CardContent>
    </Card>
  );
}
