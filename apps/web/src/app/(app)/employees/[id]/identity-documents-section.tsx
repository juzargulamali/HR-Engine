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
    .select("id, document_type, document_number, expiry_date, file_path")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });

  // Signed URLs, not public ones — the bucket is private (RLS-gated by
  // storage.objects policies), so a link only ever works for someone this
  // page would already show the row to, and only for a few minutes.
  const documentsWithUrl = await Promise.all(
    (documents ?? []).map(async (d) => {
      if (!d.file_path) return { ...d, url: null };
      const { data } = await supabase.storage.from("identity-documents").createSignedUrl(d.file_path, 300);
      return { ...d, url: data?.signedUrl ?? null };
    }),
  );

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Number</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {documentsWithUrl.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="capitalize">{d.document_type.replace("_", " ")}</TableCell>
              <TableCell className="font-mono text-xs">{d.document_number}</TableCell>
              <TableCell>{d.expiry_date ?? "—"}</TableCell>
              <TableCell>
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    View / Download
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {documentsWithUrl.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
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
