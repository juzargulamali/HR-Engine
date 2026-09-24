import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddInsuranceForm } from "./add-insurance-form";
import { DeleteInsurancePolicyButton } from "./delete-insurance-policy-button";
import { EmptyState } from "@/components/ui/empty-state";

export async function InsuranceSection({ employeeId, canEdit }: { employeeId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data: policies } = await supabase
    .from("employee_insurance_policies")
    .select("id, insurance_name, policy_number, expiry_date, file_path")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });

  // Signed URLs, not public ones — the bucket is private (RLS-gated by
  // storage.objects policies), so a link only ever works for someone this
  // page would already show the row to, and only for a few minutes.
  const policiesWithUrl = await Promise.all(
    (policies ?? []).map(async (p) => {
      if (!p.file_path) return { ...p, url: null };
      const { data } = await supabase.storage.from("insurance-documents").createSignedUrl(p.file_path, 300);
      return { ...p, url: data?.signedUrl ?? null };
    }),
  );

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Insurance</TableHead>
            <TableHead>Policy number</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {policiesWithUrl.map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.insurance_name}</TableCell>
              <TableCell className="font-mono text-xs">{p.policy_number}</TableCell>
              <TableCell>{p.expiry_date ?? "—"}</TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      View / Download
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {canEdit ? <DeleteInsurancePolicyButton policyId={p.id} employeeId={employeeId} /> : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {policiesWithUrl.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4}>
                <EmptyState dense title="No insurance policies on file." />
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {canEdit ? <AddInsuranceForm employeeId={employeeId} /> : null}
    </div>
  );
}
