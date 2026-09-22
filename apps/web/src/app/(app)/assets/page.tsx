import { canManageAssets, hasRoleAnyScope } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { NewAssetForm } from "./new-asset-form";
import { RetireAssetButton } from "./retire-asset-button";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  in_stock: "outline",
  issued: "default",
  under_repair: "secondary",
  retired: "destructive",
};

export default async function AssetsPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const canView = hasRoleAnyScope(session.grants, "hr_admin") || hasRoleAnyScope(session.grants, "finance");
  if (!canView) {
    return <Alert variant="destructive">The asset inventory is restricted to HR Admin and Finance.</Alert>;
  }

  const supabase = await createClient();
  // No explicit company filter — like employees/page.tsx, RLS alone decides
  // what's visible (every company an HR Admin/Finance grant covers).
  const [{ data: assets }, { data: companies }, { data: activeAssignments }] = await Promise.all([
    supabase
      .from("assets")
      .select("id, company_id, asset_tag, category, description, purchase_date, value, status")
      .order("asset_tag"),
    supabase.from("companies").select("id, legal_name"),
    supabase.from("asset_assignments").select("asset_id, employee_id").is("returned_date", null),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.legal_name]));
  const manageableCompanies = (companies ?? []).filter((c) => canManageAssets(session.grants, c.id));

  const holderEmployeeIds = [...new Set((activeAssignments ?? []).map((a) => a.employee_id))];
  const { data: holders } =
    holderEmployeeIds.length > 0
      ? await supabase.from("employees").select("id, first_name, last_name").in("id", holderEmployeeIds)
      : { data: [] as never[] };
  const holderName = new Map((holders ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const holderByAsset = new Map((activeAssignments ?? []).map((a) => [a.asset_id, a.employee_id]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Assets</h1>
        <p className="text-muted-foreground">
          Company inventory and who currently holds what. Assign or return an item from that person&apos;s own
          Employees page.
        </p>
      </div>

      {manageableCompanies.length > 0 ? (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Add an asset</CardTitle>
          </CardHeader>
          <CardContent>
            <NewAssetForm companies={manageableCompanies} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Inventory</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Held by</TableHead>
                <TableHead>Value</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(assets ?? []).map((a) => {
                const holderId = holderByAsset.get(a.id);
                const canManageThisOne = canManageAssets(session.grants, a.company_id);
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.asset_tag}</TableCell>
                    <TableCell className="capitalize">{a.category}</TableCell>
                    <TableCell>{companyName.get(a.company_id) ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{a.status.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell>{holderId ? holderName.get(holderId) ?? "—" : "—"}</TableCell>
                    <TableCell>{a.value ?? "—"}</TableCell>
                    <TableCell>
                      {canManageThisOne && a.status !== "retired" ? <RetireAssetButton assetId={a.id} /> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(assets ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No assets on file yet.
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
