"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageEmployeeDocuments, canManageIdentityDocuments } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { discardHrUpload, readBackHrUpload, signHrUpload } from "@/lib/hr-upload-server";
import { sanitizeForStoragePath, UPLOAD_PAGE_OUT_OF_DATE, validateUploadMeta, type DeclaredFile, type PrepareUploadResult } from "@/lib/upload-rules";
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

/** The file a form declares (name, type, size), read from the three fields it posts instead of the bytes. Null when no file was chosen. */
function declaredFile(formData: FormData, prefix = "file"): DeclaredFile | null {
  const name = String(formData.get(`${prefix}Name`) ?? "");
  if (!name) return null;
  return { name, type: String(formData.get(`${prefix}Type`) ?? ""), size: Number(formData.get(`${prefix}Size`) ?? 0) };
}

/** A form from before this change still posts the bytes: say so plainly instead of silently saving the row without its file. */
const postsBytes = (formData: FormData, field = "file") => { const v = formData.get(field); return v instanceof File && v.size > 0; };

const storeFor = (rule: { store: "identity" | "employee" }) => rule.store === "identity"
  ? { table: "identity_documents" as const, bucket: "identity-documents" as const }
  : { table: "employee_documents" as const, bucket: "employee-documents" as const };

/** `<company>/<employee>/<type>/<submission>-<name>`: the same convention as every earlier document, with the one-time submission id as the retry key. */
const documentPath = (companyId: string, employeeId: string, code: string, submission: string, name: string) =>
  `${companyId}/${employeeId}/${sanitizeForStoragePath(code)}/${submission}-${sanitizeForStoragePath(name)}`;

/**
 * Step 1 of adding a document with a file (see addDocument). Nothing is recorded here: it only authorises, checks the declared file and hands back the one-time upload link
 * (or, on a retry whose file is already stored, says so with no link).
 */
export async function prepareDocumentUpload(input: { employeeId: string; typeKey: string; submissionId: string; name: string; size: number; type: string }): Promise<PrepareUploadResult> {
  const employeeId = uuid.safeParse(input.employeeId);
  if (!employeeId.success) return { error: "That employee could not be identified. Reload the page and try again." };
  const submission = uuid.safeParse(input.submissionId);
  if (!submission.success) return { error: UPLOAD_PAGE_OUT_OF_DATE };
  const rule = ruleForKey(input.typeKey);
  if (!rule) return { error: "Choose a document type." };
  const metaError = validateUploadMeta(input);
  if (metaError) return { error: metaError };

  const session = await getCurrentSession();
  if (!session) return { error: "Sign in again to continue." };
  const supabase = await createClient();
  const { data: employee } = await supabase.from("employees").select("company_id").eq("id", employeeId.data).maybeSingle();
  if (!employee) return { error: "Employee not found." };
  const allowed = rule.store === "identity" ? canManageIdentityDocuments(session.grants, employee.company_id) : canManageEmployeeDocuments(session.grants, employee.company_id);
  if (!allowed) return { error: "Only an HR Admin of this employee's company can add documents." };

  return signHrUpload(storeFor(rule).bucket, documentPath(employee.company_id, employeeId.data, storedCode(rule), submission.data, input.name));
}

/**
 * The one "Add document" action. The document TYPE decides the table and the fields (lib/hr/document-types.ts): identity types go to identity_documents (number required,
 * scan optional; readable by the person and their HR Admin only), every other type to employee_documents (a file is always required; the daily expiry job tracks it).
 * Both tables, buckets, paths and signed links are the ones the two earlier forms used; nothing about existing rows changes, and a renewal only ADDS a row (the earlier
 * document stays in the history).
 *
 * THE FILE DOES NOT PASS THROUGH THIS ACTION. A Next.js server action accepts a 1 MB body unless raised and a Vercel function 4.5 MB, so a 2 MB Emirates ID scan failed
 * before this code ever ran (while the screen promised up to 10 MB). The file now goes in three steps, the same shape as Sales and Projects files:
 *   1. prepareDocumentUpload  - authorises the person for THIS employee from the database, checks the declared name/type/size against the displayed limits, builds the path
 *      (company/employee/type/submission-name) and returns a one-time signed link for the private bucket;
 *   2. the browser sends the bytes straight to that link;
 *   3. this action - authorises again, reads the stored file back (real size and leading bytes) and only then saves the row linking it. A file that fails any check, or a
 *      row that cannot be saved, deletes the file again.
 * The form posts only the file's declared name, type and size (`fileName`, `fileType`, `fileSize`), never the bytes.
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
  if (postsBytes(formData)) return { error: UPLOAD_PAGE_OUT_OF_DATE };

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
  const file = declaredFile(formData);

  const missing = missingForType(rule, { number, expiry, hasFile: file !== null });
  if (missing) return { error: missing };
  if (expiry && !isoDate.test(expiry)) return { error: "Enter the expiry date as a calendar date." };
  if (file) {
    const invalid = validateUploadMeta(file);
    if (invalid) return { error: invalid };
  }

  const { table, bucket } = storeFor(rule);
  const code = storedCode(rule);

  // The document being renewed must be this employee's own, of the same kind; it is only read, never changed.
  const renews = String(formData.get("renewsDocumentId") ?? "");
  if (renews) {
    if (!uuid.safeParse(renews).success) return { error: "The document being renewed was not found." };
    const { data: earlier } = await supabase.from(table).select("id").eq("id", renews).eq("employee_id", employeeId.data).maybeSingle();
    if (!earlier) return { error: "The document being renewed was not found." };
  }

  // A file needs the form's one-time id: it is the retry key. (The form always sends one.)
  const submission = uuid.safeParse(String(formData.get("submissionId") ?? ""));
  if (file && !submission.success) return { error: UPLOAD_PAGE_OUT_OF_DATE };
  const filePath = file && submission.success ? documentPath(employee.company_id, employeeId.data, code, submission.data, file.name) : null;

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

  // The browser has already sent the file to private storage: check what really arrived before anything points at it.
  if (file && filePath) {
    const checked = await readBackHrUpload(bucket, filePath, file);
    if (checked.error) return { error: checked.error };
  }

  const row = rule.store === "identity"
    ? { employee_id: employeeId.data, document_type: code, document_number: number, expiry_date: expiry, file_path: filePath, created_by: session.userId }
    : { employee_id: employeeId.data, document_type: code, file_path: filePath as string, expiry_date: expiry };
  const { data: created, error } = await supabase.from(table).insert(row as never).select("id").maybeSingle();
  if (error || !created) {
    if (filePath) {
      // A simultaneous retry may have saved the row a moment earlier: then the file is in use and stays.
      const { data: raced } = await supabase.from(table).select("id").eq("employee_id", employeeId.data).eq("file_path", filePath).maybeSingle();
      if (raced) return { error: null, saved: { id: raced.id, label: rule.label, existing: true } };
      // Without this a failed row insert leaves the file in storage with nothing pointing at it.
      await discardHrUpload(bucket, filePath);
    }
    return { error: error?.message ?? "The document could not be saved." };
  }

  revalidatePath(`/employees/${employeeId.data}`);
  return { error: null, saved: { id: created.id, label: rule.label, existing: false } };
}

export interface AttachFileState extends ActionState {
  /** True when the file is now on the document (also true for a repeat that had already been attached). */
  attached?: boolean;
}

/** The identity document, its employee's company and the person's right to manage it, all from the database. */
async function loadIdentityTarget(documentId: string) {
  const session = await getCurrentSession();
  if (!session) return { error: "Sign in again to continue." } as const;
  const supabase = await createClient();
  const { data: doc } = await supabase.from("identity_documents").select("id, employee_id, document_type, file_path").eq("id", documentId).maybeSingle();
  if (!doc) return { error: "That document was not found." } as const;
  const { data: employee } = await supabase.from("employees").select("company_id").eq("id", doc.employee_id).maybeSingle();
  if (!employee) return { error: "Employee not found." } as const;
  if (!canManageIdentityDocuments(session.grants, employee.company_id)) return { error: "Only an HR Admin of this employee's company can attach a file to this document." } as const;
  return { error: null, supabase, doc, companyId: employee.company_id } as const;
}

/**
 * Step 1 of "Attach file" on an existing identity document that has none (Documents tab). Authorises the HR Admin of the employee's company from the document's own employee,
 * never from the browser; refuses a document that already has a different file. The path is the same company/employee/type/submission-name convention as an added document.
 */
export async function prepareIdentityFileUpload(input: { documentId: string; submissionId: string; name: string; size: number; type: string }): Promise<PrepareUploadResult> {
  const documentId = uuid.safeParse(input.documentId);
  const submission = uuid.safeParse(input.submissionId);
  if (!documentId.success) return { error: "That document was not found." };
  if (!submission.success) return { error: UPLOAD_PAGE_OUT_OF_DATE };
  const metaError = validateUploadMeta(input);
  if (metaError) return { error: metaError };
  const target = await loadIdentityTarget(documentId.data);
  if (target.error) return { error: target.error };
  const path = documentPath(target.companyId, target.doc.employee_id, target.doc.document_type, submission.data, input.name);
  if (target.doc.file_path && target.doc.file_path !== path) return { error: "This document already has a file attached." };
  return signHrUpload("identity-documents", path);
}

/**
 * Step 3 of "Attach file": rechecks the authorisation, reads the stored file back, then sets file_path on THAT SAME row (id, number and dates untouched) and only while it is
 * still empty. A repeat for a file that is already attached succeeds without changing anything; a file that fails a check, or a row that already got a different file, deletes
 * the uploaded file again.
 */
export async function attachIdentityFile(input: { documentId: string; submissionId: string; name: string; size: number; type: string }): Promise<AttachFileState> {
  const documentId = uuid.safeParse(input.documentId);
  const submission = uuid.safeParse(input.submissionId);
  if (!documentId.success) return { error: "That document was not found." };
  if (!submission.success) return { error: UPLOAD_PAGE_OUT_OF_DATE };
  const metaError = validateUploadMeta(input);
  if (metaError) return { error: metaError };
  const target = await loadIdentityTarget(documentId.data);
  if (target.error) return { error: target.error };
  const { supabase, doc } = target;

  const path = documentPath(target.companyId, doc.employee_id, doc.document_type, submission.data, input.name);
  if (doc.file_path === path) return { error: null, attached: true };
  if (doc.file_path) return { error: "This document already has a file attached." };

  const checked = await readBackHrUpload("identity-documents", path, input);
  if (checked.error) return { error: checked.error };

  const { data: updated, error } = await supabase.from("identity_documents").update({ file_path: path }).eq("id", doc.id).is("file_path", null).select("id");
  if (error || !updated || updated.length === 0) {
    // Someone attached a file in the meantime: if it is this very file (a simultaneous retry) it stays, otherwise ours is removed.
    const { data: now } = await supabase.from("identity_documents").select("file_path").eq("id", doc.id).maybeSingle();
    if (now?.file_path === path) return { error: null, attached: true };
    await discardHrUpload("identity-documents", path);
    return { error: now?.file_path ? "This document already has a file attached." : (error?.message ?? "The file could not be attached.") };
  }

  revalidatePath(`/employees/${doc.employee_id}`);
  return { error: null, attached: true };
}
