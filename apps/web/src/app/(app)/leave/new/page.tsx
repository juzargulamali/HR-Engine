import { resolvePolicyVersionAsOf } from "@enginious-hr/domain";
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

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("country_code")
    .eq("id", session.employeeId)
    .single();

  // Leave types come from the leave_rules policy version actually in effect
  // today for the employee's country (docs/09-extending-the-system.md) —
  // nothing here is hard-coded per country. Uncontrolled free-text leave
  // types used to be allowed as a fallback when none was configured; now
  // submission is blocked outright with a clear HR-configuration message
  // instead, both here and (authoritatively) in submitLeaveRequest() itself.
  let leaveTypes: { code: string; name: string }[] = [];
  let hasActivePolicy = false;
  if (employee) {
    const { data: versions } = await supabase
      .from("policy_versions")
      .select("id, status, effective_from, effective_to, version_no")
      .eq("country_code", employee.country_code)
      .eq("policy_type", "leave_rules");
    const active = resolvePolicyVersionAsOf(
      (versions ?? []).map((v) => ({
        id: v.id,
        effectiveFrom: v.effective_from,
        effectiveTo: v.effective_to,
        versionNo: v.version_no,
        status: v.status,
      })),
      today,
    );
    hasActivePolicy = !!active;

    if (active) {
      const { data: rows } = await supabase
        .from("policy_leave_types")
        .select("leave_type_code, name")
        .eq("policy_version_id", active.id);
      leaveTypes = (rows ?? []).map((r) => ({ code: r.leave_type_code, name: r.name }));
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Request leave</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasActivePolicy ? (
          <Alert variant="destructive">
            HR hasn&apos;t activated a leave policy for your country yet. Leave requests can&apos;t be submitted until
            one is active — ask HR Admin to activate one.
          </Alert>
        ) : leaveTypes.length === 0 ? (
          <Alert variant="destructive">
            Your country&apos;s active leave policy doesn&apos;t define any leave types yet. Ask HR Admin to add at
            least one before you can request leave.
          </Alert>
        ) : (
          <LeaveRequestForm leaveTypes={leaveTypes} />
        )}
      </CardContent>
    </Card>
  );
}
