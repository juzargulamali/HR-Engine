import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddInsuranceForm } from "./add-insurance-form";
import { DeleteInsurancePolicyButton } from "./delete-insurance-policy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/workspace/states";
import { expiryState } from "@/lib/hr/document-types";

/** The review sentence for a policy: what its expiry date means and who acts next. Only what the record supports: policies have an expiry date, and an HR Admin manages them. */
export function policyReview(expiry: string | null, today: string): { text: string; attention: boolean } {
  const s = expiryState(expiry, today);
  if (s === "none") return { text: "No expiry date recorded", attention: false };
  if (s === "expired") return { text: "Expired. An HR Admin renews it", attention: true };
  if (s === "expiring") {
    const days = Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    return { text: `Expires in ${days} ${days === 1 ? "day" : "days"}. An HR Admin renews it`, attention: true };
  }
  return { text: "Active", attention: false };
}

export async function InsuranceSection({
  employeeId,
  canEdit,
  employeeName,
  companyName,
  today = new Date().toISOString().slice(0, 10),
}: {
  employeeId: string;
  canEdit: boolean;
  employeeName?: string;
  companyName?: string;
  /** The employee's calendar day (their country); defaults to the UTC day when a caller does not pass one. */
  today?: string;
}) {
  const supabase = await createClient();
  const { data: policies, error } = await supabase
    .from("employee_insurance_policies")
    .select("id, insurance_name, policy_number, expiry_date, file_path")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });

  if (error) {
    // A failed read is not "No insurance policies on file". Adding one does not depend on the list, so that form stays.
    return (
      <div className="space-y-4">
        <LoadError what="the insurance policies" retryHref={`/employees/${employeeId}?tab=insurance-loans`} />
        {canEdit ? <AddInsuranceForm employeeId={employeeId} employeeName={employeeName} companyName={companyName} /> : null}
      </div>
    );
  }

  // Signed URLs, not public ones — the bucket is private (RLS-gated by
  // storage.objects policies), so a link only ever works for someone this
  // page would already show the row to, and only for a few minutes.
  const policiesWithUrl = await Promise.all(
    (policies ?? []).map(async (p) => {
      if (!p.file_path) return { ...p, url: null, urlFailed: false };
      const { data, error: urlError } = await supabase.storage.from("insurance-documents").createSignedUrl(p.file_path, 300);
      return { ...p, url: data?.signedUrl ?? null, urlFailed: !!urlError };
    }),
  );

  return (
    <div className="space-y-4">
      <Table stack>
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
              <TableCell className="font-mono text-sm">{p.policy_number}</TableCell>
              <TableCell>
                <div>{p.expiry_date ?? "—"}</div>
                <div className={policyReview(p.expiry_date, today).attention ? "text-sm font-medium text-warning" : "text-sm text-muted-foreground"} data-testid="policy-review">
                  {policyReview(p.expiry_date, today).text}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      View / Download
                    </a>
                  ) : p.urlFailed ? (
                    <span className="text-sm text-destructive">File link could not be loaded; reload to try again</span>
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

      {canEdit ? <AddInsuranceForm employeeId={employeeId} employeeName={employeeName} companyName={companyName} /> : null}
    </div>
  );
}
