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

  // The leave type list is resolved against the policy version in effect on
  // the leave's start_date — not today — the same rule submitLeaveRequest()
  // and guard_leave_request_type() apply, so a request that starts after a
  // newer policy takes effect sees that policy's leave types, not today's.
  // Every version (not just whichever is active today) is sent down so the
  // form can re-resolve as the employee changes the start date, entirely
  // client-side. Uncontrolled free-text leave types used to be allowed as a
  // fallback when none was configured; now submission is blocked outright
  // with a clear HR-configuration message instead, both here and
  // (authoritatively) in submitLeaveRequest() itself.
  let versions: { id: string; effectiveFrom: string; effectiveTo: string | null; versionNo: number; status: "draft" | "active" | "superseded" }[] = [];
  let leaveTypesByVersion: Record<string, { code: string; name: string }[]> = {};
  if (employee) {
    const { data: versionRows } = await supabase
      .from("policy_versions")
      .select("id, status, effective_from, effective_to, version_no")
      .eq("country_code", employee.country_code)
      .eq("policy_type", "leave_rules");
    versions = (versionRows ?? []).map((v) => ({
      id: v.id,
      effectiveFrom: v.effective_from,
      effectiveTo: v.effective_to,
      versionNo: v.version_no,
      status: v.status,
    }));

    const versionIds = versions.map((v) => v.id);
    if (versionIds.length > 0) {
      const { data: leaveTypeRows } = await supabase
        .from("policy_leave_types")
        .select("policy_version_id, leave_type_code, name")
        .in("policy_version_id", versionIds);
      leaveTypesByVersion = {};
      for (const row of leaveTypeRows ?? []) {
        (leaveTypesByVersion[row.policy_version_id] ??= []).push({ code: row.leave_type_code, name: row.name });
      }
    }
  }

  const hasAnyActivePolicy = resolvePolicyVersionAsOf(versions, today) !== null;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Request leave</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasAnyActivePolicy ? (
          <Alert variant="destructive">
            HR hasn&apos;t activated a leave policy for your country yet. Leave requests can&apos;t be submitted until
            one is active — ask HR Admin to activate one.
          </Alert>
        ) : (
          <LeaveRequestForm versions={versions} leaveTypesByVersion={leaveTypesByVersion} today={today} />
        )}
      </CardContent>
    </Card>
  );
}
