import Link from "next/link";
import { notFound } from "next/navigation";
import {
  canActivatePolicy,
  canEditDraftPolicyContent,
  getBusinessDateString,
  parseRecoveryWindowRules,
  resolveCountryTimeZone,
} from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActivateButton } from "../activate-button";
import { ActivateRecoveryWindowsForm } from "./activate-recovery-windows-form";
import { AddLeaveTypeForm } from "./add-leave-type-form";
import { EmptyState } from "@/components/ui/empty-state";

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: policy } = await supabase
    .from("policy_versions")
    .select("id, country_code, policy_type, version_no, status, effective_from, effective_to, payload, created_by, approved_by, approved_at, activation_record")
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

  // A window-based Recovery Leave policy (working periods + 24-elapsed-hour
  // windows) has its own machine-readable rules, database-generated wording and
  // a controlled activation (effective date chosen by HR, never retroactive).
  const isWindowsPolicy = policy.policy_type === "overtime_rules" && policy.payload?.model === "recovery_windows";
  const parsedRules = isWindowsPolicy ? parseRecoveryWindowRules(policy.payload.rules) : null;
  const windowsRules = parsedRules && "rules" in parsedRules ? parsedRules.rules : null;
  const wording = typeof policy.payload?.wording === "string" ? (policy.payload.wording as string) : null;
  const countryTz = resolveCountryTimeZone(policy.country_code);
  const minEffective = (() => {
    const today = getBusinessDateString(countryTz);
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const { data: currentlyInForce } = isWindowsPolicy
    ? await supabase
        .from("policy_versions")
        .select("version_no")
        .eq("country_code", policy.country_code)
        .eq("policy_type", "overtime_rules")
        .eq("status", "active")
        .neq("id", policy.id)
        .is("effective_to", null)
        .maybeSingle()
    : { data: null };
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
          {canActivate && !isWindowsPolicy ? <ActivateButton policyVersionId={policy.id} /> : null}
        </div>
      </div>

      {policy.status === "draft" && isDrafter ? (
        <p className="text-sm text-muted-foreground">
          You drafted this version — a different HR Admin or the CEO/CTO for {country?.name} needs to activate it.
        </p>
      ) : null}

      {isWindowsPolicy ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>How Recovery Leave is calculated</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {windowsRules ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow><TableCell>Window length (real elapsed hours)</TableCell><TableCell>{windowsRules.windowHours} h</TableCell></TableRow>
                    <TableRow><TableCell>Clocked-out gap that ends a working period</TableCell><TableCell>{windowsRules.restGapHours} h or more</TableCell></TableRow>
                    <TableRow><TableCell>Normal working day</TableCell><TableCell>up to and including {windowsRules.normalDay.zeroMaxHours} h = 0 · over {windowsRules.normalDay.zeroMaxHours} h up to and including {windowsRules.normalDay.halfMaxHours} h = 0.5 day · over {windowsRules.normalDay.halfMaxHours} h = 1 day</TableCell></TableRow>
                    <TableRow><TableCell>Weekly rest day / public holiday</TableCell><TableCell>under {windowsRules.restDay.zeroBelowHours} h = 0 · {windowsRules.restDay.zeroBelowHours} h up to and including {windowsRules.restDay.halfMaxHours} h = 0.5 day · over {windowsRules.restDay.halfMaxHours} h = 1 day</TableCell></TableRow>
                    <TableRow><TableCell>Maximum per window</TableCell><TableCell>{windowsRules.maxDaysPerWindow} day</TableCell></TableRow>
                    <TableRow><TableCell>Normal daily requirement (display only)</TableCell><TableCell>{windowsRules.normalDayRequiredHours} recorded hours</TableCell></TableRow>
                    <TableRow><TableCell>HR long-work alert</TableCell><TableCell>{windowsRules.alertWorkHours} recorded hours without a {windowsRules.restGapHours} h rest</TableCell></TableRow>
                    <TableRow><TableCell>Expiry</TableCell><TableCell>{windowsRules.expiryDays} days after earning · never converted to cash</TableCell></TableRow>
                  </TableBody>
                </Table>
              ) : (
                <p className="text-destructive">These rules are not valid: {parsedRules && "issues" in parsedRules ? parsedRules.issues.join(" ") : "missing"}</p>
              )}
              {wording ? (
                <div>
                  <p className="mb-1 font-medium">Policy wording (generated from the rules above — it cannot disagree with the calculation)</p>
                  <div className="space-y-2 rounded-md bg-secondary/60 p-4 text-sm">
                    {wording.split("\n").map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                  </div>
                </div>
              ) : null}
              {typeof policy.payload?.statutory_safeguard === "string" ? (
                <p className="text-xs text-muted-foreground">{policy.payload.statutory_safeguard as string}</p>
              ) : null}
            </CardContent>
          </Card>

          {policy.activation_record ? (
            <Card>
              <CardHeader>
                <CardTitle>Activation record</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Activated {String(policy.activation_record.activated_at ?? "").slice(0, 10)} with a controlled effective date of{" "}
                {String(policy.activation_record.effective_from ?? "")}
                {policy.activation_record.supersedes_version_no
                  ? `; version ${policy.activation_record.supersedes_version_no} ended on ${policy.activation_record.supersedes_ended_on}.`
                  : "."}
              </CardContent>
            </Card>
          ) : null}

          {canActivate ? (
            <Card>
              <CardHeader>
                <CardTitle>Activate with a controlled effective date</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivateRecoveryWindowsForm
                  policyVersionId={policy.id}
                  minDate={minEffective}
                  countryName={country?.name ?? policy.country_code}
                  supersedesLabel={currentlyInForce ? `Version ${currentlyInForce.version_no}` : null}
                />
              </CardContent>
            </Card>
          ) : null}
        </>
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
