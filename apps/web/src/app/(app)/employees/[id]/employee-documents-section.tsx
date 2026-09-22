import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AddEmployeeDocumentForm } from "./add-employee-document-form";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  valid: "default",
  expiring_soon: "secondary",
  expired: "destructive",
};

export async function EmployeeDocumentsSection({
  employeeId,
  companyId,
  canEdit,
}: {
  employeeId: string;
  companyId: string;
  canEdit: boolean;
}) {
  const supabase = await createClient();
  const { data: documents } = await supabase
    .from("employee_documents")
    .select("id, document_type, expiry_date, status")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(documents ?? []).map((d) => (
            <TableRow key={d.id}>
              <TableCell className="capitalize">{d.document_type.replace(/_/g, " ")}</TableCell>
              <TableCell>{d.expiry_date ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"}>{d.status.replace(/_/g, " ")}</Badge>
              </TableCell>
            </TableRow>
          ))}
          {(documents ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                No documents on file.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {canEdit ? <AddEmployeeDocumentForm employeeId={employeeId} companyId={companyId} /> : null}
    </div>
  );
}
