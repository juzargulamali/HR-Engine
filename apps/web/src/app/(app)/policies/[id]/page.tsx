import Link from "next/link";
import { notFound } from "next/navigation";
import { canActivatePolicy, canEditDraftPolicyContent } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActivateButton } from "../activate-button";
import { AddLeaveTypeForm } from "./add-leave-type-form";
import { EmptyState } from "@/components/ui/empty-state";

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: policy } = await supabase
    .from("policy_versions")
    .select("id, country_code, policy_type, version_no, status, effective_from, effective_to, payload, created_by, approved_by, approved_at")
    .eq("id", id)
    .maybeSingle();

  if (!policy) notFound();

  const { data: country } = await supabase.from("countries").select("name").eq("code", policy.country_code).single();
  const { data: leaveTypes } =
    policy.policy_type === "leave_rules"
      ? await supabase
          .from("policy_leave_types")
          .select("id, leave_type_code, name, accrual_method, accrual_rate_per_period, max_balance_days, carryover_max_days")
          .eq("policy_version_id", policy.id)
      : { data: null };

  const isDrafter = policy.created_by === session.userId;
  const canActivate = policy.status === "draft" && canActivatePolicy(session.grants, policy.country_code, isDrafter);
  const canEditContent = policy.status === "draft" && canEditDraftPolicyContent(session.grants, policy.country_code);

  return (
    <div className="space-y-6">
      <Link href="/policies" className="text-sm text-muted-foreground hover:underline">
        ← Back to policies
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold capitalize">{policy.policy_type.replace(/_/g, " ")}</h1>
          <p className="text-muted-foreground">
            {country?.name} · version {policy.version_no} · effective {policy.effective_from}
            {policy.effective_to ? ` – ${policy.effective_to}` : " – open-ended"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={policy.status === "active" ? "default" : policy.status === "draft" ? "secondary" : "outline"}>
            {policy.status}
          </Badge>
          {canActivate ? <ActivateButton policyVersionId={policy.id} /> : null}
        </div>
      </div>

      {policy.status === "draft" && isDrafter ? (
        <p className="text-sm text-muted-foreground">
          You drafted this version — a different HR Admin or the CEO/CTO for {country?.name} needs to activate it.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Payload</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-secondary/60 p-4 text-xs">{JSON.stringify(policy.payload, null, 2)}</pre>
        </CardContent>
      </Card>

      {policy.policy_type === "leave_rules" ? (
        <Card>
          <CardHeader>
            <CardTitle>Leave types</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Accrual</TableHead>
                  <TableHead>Rate/period</TableHead>
                  <TableHead>Max balance</TableHead>
                  <TableHead>Carryover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(leaveTypes ?? []).map((lt) => (
                  <TableRow key={lt.id}>
                    <TableCell className="font-mono text-xs">{lt.leave_type_code}</TableCell>
                    <TableCell>{lt.name}</TableCell>
                    <TableCell>{lt.accrual_method.replace(/_/g, " ")}</TableCell>
                    <TableCell>{lt.accrual_rate_per_period ?? "—"}</TableCell>
                    <TableCell>{lt.max_balance_days ?? "—"}</TableCell>
                    <TableCell>{lt.carryover_max_days ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {(leaveTypes ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState dense title="No leave types added yet." />
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>

            {canEditContent ? <AddLeaveTypeForm policyVersionId={policy.id} /> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
