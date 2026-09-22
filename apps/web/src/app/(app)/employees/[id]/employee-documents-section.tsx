import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AddEmployeeDocumentForm } from "./add-employee-document-form";
import { DeleteEmployeeDocumentButton } from "./delete-employee-document-button";

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
    .select("id, document_type, expiry_date, status, file_path, deleted_at")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });

  // Signed URLs, not public ones — the bucket is private (RLS-gated by
  // storage.objects policies), so a link only ever works for someone this
  // page would already show the row to, and only for a few minutes.
  const documentsWithUrl = await Promise.all(
    (documents ?? []).map(async (d) => {
      if (!d.file_path) return { ...d, url: null };
      const { data } = await supabase.storage.from("employee-documents").createSignedUrl(d.file_path, 300);
      return { ...d, url: data?.signedUrl ?? null };
    }),
  );

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {documentsWithUrl.map((d) => (
            <TableRow key={d.id} className={d.deleted_at ? "opacity-60" : undefined}>
              <TableCell className="capitalize">{d.document_type.replace(/_/g, " ")}</TableCell>
              <TableCell>{d.expiry_date ?? "—"}</TableCell>
              <TableCell>
                {d.deleted_at ? (
                  <Badge variant="destructive">removed</Badge>
                ) : (
                  <Badge variant={STATUS_VARIANT[d.status] ?? "secondary"}>{d.status.replace(/_/g, " ")}</Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      View / Download
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {canEdit ? (
                    <DeleteEmployeeDocumentButton documentId={d.id} employeeId={employeeId} deleted={Boolean(d.deleted_at)} />
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {documentsWithUrl.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
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
