import Link from "next/link";
import { canActivatePolicy, canDeleteDraftPolicy, canDraftPolicy } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CreatePhase2bDraftsButton } from "./create-phase2b-drafts-button";
import { PolicyVersionsTable, type PolicyVersionRow } from "./policy-versions-table";

export default async function PoliciesPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const [{ data: policies }, { data: countries }, { data: phase2bStatus }] = await Promise.all([
    supabase
      .from("policy_versions")
      .select("id, country_code, policy_type, version_no, status, effective_from, effective_to, created_by")
      .order("country_code")
      .order("policy_type")
      .order("version_no", { ascending: false }),
    supabase.from("countries").select("code, name").order("name"),
    // Read-only — safe to call even for a viewer with no drafting rights;
    // used only to decide whether the button below still has anything to do.
    supabase.rpc("preflight_phase2b_v2_policy_status"),
  ]);

  // policy_leave_types.policy_version_id has no ON DELETE CASCADE — deleting
  // a policy_versions row that still has leave-type rows configured under
  // it fails at the database with a foreign-key violation. Fetched here
  // purely to know which draft versions that applies to, so Delete can be
  // hidden for them instead of surfacing a raw DB error after the click;
  // nothing is deleted or modified by this query.
  const policyVersionIds = (policies ?? []).map((p) => p.id);
  const { data: leaveTypeLinks } =
    policyVersionIds.length > 0
      ? await supabase.from("policy_leave_types").select("policy_version_id").in("policy_version_id", policyVersionIds)
      : { data: [] as { policy_version_id: string }[] };
  const versionIdsWithLeaveTypes = new Set((leaveTypeLinks ?? []).map((l) => l.policy_version_id));

  const countryName = new Map((countries ?? []).map((c) => [c.code, c.name]));
  const canDraftAnywhere = (countries ?? []).some((c) => canDraftPolicy(session.grants, c.code));
  const phase2bAllCreated = (phase2bStatus ?? []).length > 0 && (phase2bStatus ?? []).every((r) => r.status !== "not_created");

  // The query above orders each (country_code, policy_type) group by
  // version_no descending, so the first row encountered per group is that
  // group's latest version — tracked here purely to decide what the table
  // shows by default; every row is still fetched and available once the
  // "Show older versions" toggle is used, nothing is filtered at the query
  // level.
  const seenGroups = new Set<string>();
  const rows: PolicyVersionRow[] = (policies ?? []).map((p) => {
    const groupKey = `${p.country_code}:${p.policy_type}`;
    const isLatest = !seenGroups.has(groupKey);
    seenGroups.add(groupKey);

    const isDrafter = p.created_by === session.userId;
    return {
      id: p.id,
      countryLabel: countryName.get(p.country_code) ?? p.country_code,
      policyType: p.policy_type,
      versionNo: p.version_no,
      effectiveFrom: p.effective_from,
      effectiveTo: p.effective_to,
      status: p.status,
      canActivate: p.status === "draft" && canActivatePolicy(session.grants, p.country_code, isDrafter),
      canDelete: p.status === "draft" && canDeleteDraftPolicy(session.grants, p.country_code),
      hasDependentConfig: versionIdsWithLeaveTypes.has(p.id),
      isDrafter,
      isLatest,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Country policies</h1>
          <p className="text-muted-foreground">
            Leave rules, notice periods, and probation terms — versioned and effective-dated, never hard-coded.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/holidays" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Public holidays
          </Link>
          {canDraftAnywhere ? (
            <Link href="/policies/new" className={cn(buttonVariants({ size: "sm" }))}>
              Draft a policy
            </Link>
          ) : null}
        </div>
      </div>

      {canDraftAnywhere ? <CreatePhase2bDraftsButton allCreated={phase2bAllCreated} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>All policy versions you can see</CardTitle>
        </CardHeader>
        <CardContent>
          <PolicyVersionsTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
