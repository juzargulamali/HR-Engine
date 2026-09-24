import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AssignAssetForm } from "./assign-asset-form";
import { ReturnAssetControl } from "./return-asset-control";
import { EmptyState } from "@/components/ui/empty-state";

export async function AssetsSection({
  employeeId,
  companyId,
  canManage,
}: {
  employeeId: string;
  companyId: string;
  canManage: boolean;
}) {
  const supabase = await createClient();
  const [{ data: assignments }, { data: availableAssets }] = await Promise.all([
    supabase
      .from("asset_assignments")
      .select("id, asset_id, issued_date, returned_date, condition_on_issue, condition_on_return")
      .eq("employee_id", employeeId)
      .order("issued_date", { ascending: false }),
    canManage
      ? supabase.from("assets").select("id, asset_tag, category").eq("company_id", companyId).eq("status", "in_stock")
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const assetIds = [...new Set((assignments ?? []).map((a) => a.asset_id))];
  const { data: assets } =
    assetIds.length > 0 ? await supabase.from("assets").select("id, asset_tag, category").in("id", assetIds) : { data: [] as never[] };
  const assetById = new Map((assets ?? []).map((a) => [a.id, a]));

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Returned</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(assignments ?? []).map((a) => {
            const asset = assetById.get(a.asset_id);
            const isCurrent = !a.returned_date;
            return (
              <TableRow key={a.id}>
                <TableCell>
                  {asset ? (
                    <>
                      <span className="font-mono text-xs">{asset.asset_tag}</span>{" "}
                      <span className="capitalize text-muted-foreground">{asset.category}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{a.issued_date}</TableCell>
                <TableCell>
                  {isCurrent ? <Badge variant="default">Current</Badge> : a.returned_date}
                </TableCell>
                <TableCell>
                  {canManage && isCurrent ? (
                    <ReturnAssetControl assignmentId={a.id} assetId={a.asset_id} employeeId={employeeId} />
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
          {(assignments ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={4}>
                <EmptyState dense title="No assets assigned." />
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {canManage ? (
        (availableAssets ?? []).length > 0 ? (
          <AssignAssetForm employeeId={employeeId} availableAssets={availableAssets ?? []} />
        ) : (
          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            No in-stock assets available to assign — add one from the{" "}
            <a href="/assets" className="text-accent hover:underline">
              Assets
            </a>{" "}
            page first.
          </p>
        )
      ) : null}
    </div>
  );
}
