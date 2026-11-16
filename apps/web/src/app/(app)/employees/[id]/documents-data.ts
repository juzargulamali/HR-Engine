import "server-only";
import { createClient } from "@/lib/supabase/server";
import { expiryState, ruleFor, type DocumentStore, type ExpiryState } from "@/lib/hr/document-types";

/** One row of the single Documents list, from either table. */
export interface DocumentRow {
  id: string;
  store: DocumentStore;
  /** The value stored in `document_type`. */
  storedType: string;
  label: string;
  /** Identity documents only, and only ever loaded for a viewer who may see identity documents. */
  number: string | null;
  expiryDate: string | null;
  state: ExpiryState;
  /** The daily job's stored status (employee documents only). */
  trackedStatus: string | null;
  removed: boolean;
  url: string | null;
  urlFailed: boolean;
  createdAt: string;
}

export interface DocumentsData { rows: DocumentRow[]; employeeDocumentsFailed: boolean; identityDocumentsFailed: boolean }

const humanise = (t: string) => { const s = t.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

/**
 * Reads both document tables for one employee, each only when the viewer may see it (the same gates the two earlier sections used) and still through row level
 * security. Links are 5-minute signed URLs from the private buckets, exactly as before. A failed read is reported per source, never shown as "no documents".
 */
export async function loadDocuments(opts: { employeeId: string; canSeeDocuments: boolean; canSeeIdentity: boolean; today: string }): Promise<DocumentsData> {
  const supabase = await createClient();
  const rows: DocumentRow[] = [];
  let employeeDocumentsFailed = false;
  let identityDocumentsFailed = false;

  if (opts.canSeeDocuments) {
    const { data, error } = await supabase.from("employee_documents").select("id, document_type, expiry_date, status, file_path, deleted_at, created_at").eq("employee_id", opts.employeeId).order("created_at", { ascending: false });
    if (error) employeeDocumentsFailed = true;
    else {
      rows.push(...(await Promise.all((data ?? []).map(async (d) => {
        let url: string | null = null; let urlFailed = false;
        if (d.file_path) { const r = await supabase.storage.from("employee-documents").createSignedUrl(d.file_path, 300); url = r.data?.signedUrl ?? null; urlFailed = !!r.error; }
        return { id: d.id, store: "employee" as const, storedType: d.document_type, label: ruleFor("employee", d.document_type)?.label ?? humanise(d.document_type), number: null, expiryDate: d.expiry_date, state: expiryState(d.expiry_date, opts.today), trackedStatus: d.status, removed: Boolean(d.deleted_at), url, urlFailed, createdAt: d.created_at };
      }))));
    }
  }
  if (opts.canSeeIdentity) {
    const { data, error } = await supabase.from("identity_documents").select("id, document_type, document_number, expiry_date, file_path, created_at").eq("employee_id", opts.employeeId).order("created_at", { ascending: false });
    if (error) identityDocumentsFailed = true;
    else {
      rows.push(...(await Promise.all((data ?? []).map(async (d) => {
        let url: string | null = null; let urlFailed = false;
        if (d.file_path) { const r = await supabase.storage.from("identity-documents").createSignedUrl(d.file_path, 300); url = r.data?.signedUrl ?? null; urlFailed = !!r.error; }
        return { id: d.id, store: "identity" as const, storedType: d.document_type, label: ruleFor("identity", d.document_type)?.label ?? humanise(d.document_type), number: d.document_number, expiryDate: d.expiry_date, state: expiryState(d.expiry_date, opts.today), trackedStatus: null, removed: false, url, urlFailed, createdAt: d.created_at };
      }))));
    }
  }
  // Newest first across both tables; the list groups by type afterwards.
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { rows, employeeDocumentsFailed, identityDocumentsFailed };
}

/** The rows of one type, newest first, grouped in the order each type first appears. */
export function groupByType(rows: readonly DocumentRow[]): { label: string; rows: DocumentRow[] }[] {
  const groups = new Map<string, DocumentRow[]>();
  for (const r of rows) groups.set(r.label, [...(groups.get(r.label) ?? []), r]);
  return [...groups.entries()].map(([label, rs]) => ({ label, rows: rs }));
}

export const STATE_WORDS: Record<ExpiryState, string> = { valid: "Valid", expiring: "Expiring soon", expired: "Expired", none: "No expiry" };
