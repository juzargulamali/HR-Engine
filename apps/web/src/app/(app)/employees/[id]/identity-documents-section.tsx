import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddIdentityDocumentForm } from "./add-identity-document-form";

export async function IdentityDocumentsSection({
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
    .from("identity_documents")
    .select("id, document_type, document_number, expiry_date")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Number</TableHead>
            <TableHead>Expiry</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(documents ?? []).map((d) => (
            <TableRow key={d.id}>
              <TableCell className="capitalize">{d.document_type.replace("_", " ")}</TableCell>
              <TableCell className="font-mono text-xs">{d.document_number}</TableCell>
              <TableCell>{d.expiry_date ?? "—"}</TableCell>
            </TableRow>
          ))}
          {(documents ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                No identity documents on file.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {canEdit ? <AddIdentityDocumentForm employeeId={employeeId} companyId={companyId} /> : null}
    </div>
  );
}
