"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageEmployeeDocuments, canManageIdentityDocuments } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { sanitizeForStoragePath, validateUploadFile } from "@/lib/uploads";
import { missingForType, ruleForKey, storedCode } from "@/lib/hr/document-types";
import type { ActionState } from "./companies";

const uuid = z.string().uuid();
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
/** A retry of the same submission within this window, with no file to key on, returns the row it already made. */
const RETRY_WINDOW_MS = 2 * 60 * 1000;

export interface AddDocumentState extends ActionState {
  /** Set when the document is on file: the form closes and says so. `existing` means a repeat of a submission that had already been saved. */
  saved?: { id: string; label: string; existing: boolean };
}

/**
 * The one "Add document" action. The document TYPE decides the table and the fields (lib/hr/document-types.ts): identity types go to identity_documents (number required,
 * scan optional; readable by the person and their HR Admin only), every other type to employee_documents (a file is always required; the daily expiry job tracks it).
 * Both tables, buckets, paths and signed links are the ones the two earlier forms used; nothing about existing rows changes, and a renewal only ADDS a row (the earlier
 * document stays in the history).
 *
 * The company is read from the employee record, never from the form: the bucket policies only check the path's company segment, so a company taken from the client could plant a
 * file under another company's employee. The domain permission is checked again here (the form hiding the button is a convenience); the table's own policy decides last.
 *
 * Retry-safe without a new column: the stored file path is built from the form's one-time `submissionId`, so a repeated click or a retry after a lost answer finds the row it
 * already made (by that path) and returns it. A type with no file (an identity number only) is matched on employee, type, number, expiry and creator inside a two-minute window.
 */
export async function addDocument(_prev: AddDocumentState, formData: FormData): Promise<AddDocumentState> {
  const employeeId = uuid.safeParse(formData.get("employeeId"));
  if (!employeeId.success) return { error: "That employee could not be identified. Reload the page and try again." };
  const rule = ruleForKey(String(formData.get("typeKey") ?? ""));
  if (!rule) return { error: "Choose a document type." };

  const session = await getCurrentSession();
  if (!session) return { error: "Sign in again to continue." };
  const supabase = await createClient();

  const { data: employee } = await supabase.from("employees").select("company_id").eq("id", employeeId.data).maybeSingle();
  if (!employee) return { error: "Employee not found." };
  const allowed = rule.store === "identity" ? canManageIdentityDocuments(session.grants, employee.company_id) : canManageEmployeeDocuments(session.grants, employee.company_id);
  if (!allowed) return { error: "Only an HR Admin of this employee's company can add documents." };

  const number = String(formData.get("number") ?? "").trim();
  const rawExpiry = String(formData.get("expiryDate") ?? "").trim();
  // A type that does not expire never stores a date, whatever was posted.
  const expiry = rule.expiry === "none" ? null : rawExpiry || null;
  const fileValue = formData.get("file");
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

  const missing = missingForType(rule, { number, expiry, hasFile: file !== null });
  if (missing) return { error: missing };
  if (expiry && !isoDate.test(expiry)) return { error: "Enter the expiry date as a calendar date." };
  if (file) {
    const invalid = validateUploadFile(file);
    if (invalid) return { error: invalid };
  }

  const table = rule.store === "identity" ? "identity_documents" : "employee_documents";
  const bucket = rule.store === "identity" ? "identity-documents" : "employee-documents";
  const code = storedCode(rule);

  // The document being renewed must be this employee's own, of the same kind; it is only read, never changed.
  const renews = String(formData.get("renewsDocumentId") ?? "");
  if (renews) {
    if (!uuid.safeParse(renews).success) return { error: "The document being renewed was not found." };
    const { data: earlier } = await supabase.from(table).select("id").eq("id", renews).eq("employee_id", employeeId.data).maybeSingle();
    if (!earlier) return { error: "The document being renewed was not found." };
  }

  const submission = String(formData.get("submissionId") ?? "");
  const prefix = uuid.safeParse(submission).success ? submission : String(Date.now());
  const filePath = file ? `${employee.company_id}/${employeeId.data}/${sanitizeForStoragePath(code)}/${prefix}-${sanitizeForStoragePath(file.name)}` : null;

  // A repeat of a submission that was already saved returns that row instead of adding a second one.
  if (filePath) {
    const { data: again } = await supabase.from(table).select("id").eq("employee_id", employeeId.data).eq("file_path", filePath).maybeSingle();
    if (again) return { error: null, saved: { id: again.id, label: rule.label, existing: true } };
  } else if (rule.store === "identity") {
    const since = new Date(Date.now() - RETRY_WINDOW_MS).toISOString();
    let q = supabase.from("identity_documents").select("id").eq("employee_id", employeeId.data).eq("document_type", code).eq("document_number", number).eq("created_by", session.userId).gte("created_at", since);
    q = expiry ? q.eq("expiry_date", expiry) : q.is("expiry_date", null);
    const { data: again } = await q.limit(1).maybeSingle();
    if (again) return { error: null, saved: { id: again.id, label: rule.label, existing: true } };
  }

  if (file && filePath) {
    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file, { contentType: file.type });
    if (uploadError) return { error: `Upload failed: ${uploadError.message}` };
  }

  const row = rule.store === "identity"
    ? { employee_id: employeeId.data, document_type: code, document_number: number, expiry_date: expiry, file_path: filePath, created_by: session.userId }
    : { employee_id: employeeId.data, document_type: code, file_path: filePath as string, expiry_date: expiry };
  const { data: created, error } = await supabase.from(table).insert(row as never).select("id").maybeSingle();
  if (error || !created) {
    // The file was already uploaded: without this a failed row insert leaves it in storage with nothing pointing at it.
    if (filePath) await supabase.storage.from(bucket).remove([filePath]);
    return { error: error?.message ?? "The document could not be saved." };
  }

  revalidatePath(`/employees/${employeeId.data}`);
  return { error: null, saved: { id: created.id, label: rule.label, existing: false } };
}
