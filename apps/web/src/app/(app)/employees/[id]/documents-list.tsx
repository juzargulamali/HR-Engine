import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { documentFormHref } from "@/lib/hr/document-types";
import { DeleteEmployeeDocumentButton } from "./delete-employee-document-button";
import { DeleteIdentityDocumentButton } from "./delete-identity-document-button";
import { groupByType, STATE_WORDS, type DocumentRow } from "./documents-data";

const STATE_VARIANT = { valid: "default", expiring: "secondary", expired: "destructive", none: "outline" } as const;

/**
 * One Documents list, both tables, grouped by type. Each row says its expiry state in words (and, for employee documents, the status the daily job stored), keeps the same
 * View / Download signed link as before, and offers Renew (HR Admin) on any document that has an expiry date. Renewing opens the shared Add document form with the type chosen;
 * it adds a new row and leaves this one in the history.
 */
export function DocumentsList({ employeeId, rows, canEditEmployeeDocuments, canEditIdentity }: { employeeId: string; rows: readonly DocumentRow[]; canEditEmployeeDocuments: boolean; canEditIdentity: boolean }) {
  const groups = groupByType(rows);
  if (groups.length === 0) return <EmptyState dense title="No documents on file." />;
  return (
    <div className="space-y-5" data-testid="documents-list">
      {groups.map((g) => (
        <section key={g.label} className="space-y-2" aria-label={g.label}>
          <h3 className="text-sm font-semibold">{g.label}</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {g.rows.map((d) => {
              const canEdit = d.store === "identity" ? canEditIdentity : canEditEmployeeDocuments;
              return (
                <li key={`${d.store}:${d.id}`} className={`space-y-2 px-3 py-3 ${d.removed ? "opacity-60" : ""}`} data-testid={`document-row-${d.id}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {d.removed ? <Badge variant="destructive">Removed</Badge> : <Badge variant={STATE_VARIANT[d.state]}>{STATE_WORDS[d.state]}</Badge>}
                    <span className="text-sm">{d.expiryDate ? `Expires ${d.expiryDate}` : "No expiry date"}</span>
                    {d.number ? <span className="font-mono text-sm" data-testid="document-number">{d.number}</span> : null}
                    {d.trackedStatus && !d.removed ? <span className="text-sm text-muted-foreground">Tracked status: {d.trackedStatus.replace(/_/g, " ")}</span> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">View / Download</a>
                    ) : d.urlFailed ? (
                      <span className="text-sm text-destructive">File link could not be loaded; reload to try again</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">No file attached</span>
                    )}
                    {canEdit && !d.removed && d.expiryDate ? (
                      <Link href={documentFormHref(employeeId, d.store, d.storedType, true, d.id)} className="text-sm font-medium text-accent hover:underline" data-testid={`renew-${d.id}`}>Renew</Link>
                    ) : null}
                    {canEdit ? (d.store === "identity" ? <DeleteIdentityDocumentButton documentId={d.id} employeeId={employeeId} /> : <DeleteEmployeeDocumentButton documentId={d.id} employeeId={employeeId} deleted={d.removed} />) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
