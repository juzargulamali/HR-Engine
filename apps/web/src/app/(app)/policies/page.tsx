import Link from "next/link";
import { canActivatePolicy, canDeleteDraftPolicy, canDraftPolicy } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActivateButton } from "./activate-button";
import { DeletePolicyVersionButton } from "./delete-policy-version-button";
import { EmptyState } from "@/components/ui/empty-state";

export default async function PoliciesPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const [{ data: policies }, { data: countries }] = await Promise.all([
    supabase
      .from("policy_versions")
      .select("id, country_code, policy_type, version_no, status, effective_from, effective_to, created_by")
      .order("country_code")
      .order("policy_type")
      .order("version_no", { ascending: false }),
    supabase.from("countries").select("code, name").order("name"),
  ]);

  const countryName = new Map((countries ?? []).map((c) => [c.code, c.name]));
  const canDraftAnywhere = (countries ?? []).some((c) => canDraftPolicy(session.grants, c.code));

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

      <Card>
        <CardHeader>
          <CardTitle>All policy versions you can see</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Country</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(policies ?? []).map((p) => {
                const isDrafter = p.created_by === session.userId;
                const canActivate = p.status === "draft" && canActivatePolicy(session.grants, p.country_code, isDrafter);
                const canDelete = p.status === "draft" && canDeleteDraftPolicy(session.grants, p.country_code);
                return (
                  <TableRow key={p.id}>
                    <TableCell>{countryName.get(p.country_code) ?? p.country_code}</TableCell>
                    <TableCell className="capitalize">{p.policy_type.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      <Link href={`/policies/${p.id}`} className="hover:underline">
                        v{p.version_no}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {p.effective_from}
                      {p.effective_to ? ` – ${p.effective_to}` : " – open"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "default" : p.status === "draft" ? "secondary" : "outline"}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {canActivate ? <ActivateButton policyVersionId={p.id} /> : null}
                        {canDelete ? <DeletePolicyVersionButton policyVersionId={p.id} /> : null}
                        {p.status === "draft" && isDrafter ? (
                          <span className="text-xs text-muted-foreground">awaiting a different approver</span>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(policies ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState dense title="No policies yet." />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
