import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let inserted: { table: string; row: Row }[] = [];
let uploads: { bucket: string; path: string }[] = [];
let removed: { bucket: string; paths: string[] }[] = [];
let insertError: { message: string } | null = null;
let uploadError: { message: string } | null = null;
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
const NEW = "99999999-9999-4999-8999-999999999999";

function from(table: string) {
  const eq: [string, unknown][] = [];
  let gte: [string, string] | null = null;
  const rows = () => (tables[table] ?? []).filter((r) => eq.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)) && (!gte || String(r[gte[0]]) >= gte[1]));
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { eq.push([k, v]); return chain; },
    is: (k: string, v: unknown) => { eq.push([k, v]); return chain; },
    gte: (k: string, v: string) => { gte = [k, v]; return chain; },
    limit: () => chain,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    insert: (row: Row) => { inserted.push({ table, row }); return { select: () => ({ maybeSingle: async () => (insertError ? { data: null, error: insertError } : { data: { id: NEW }, error: null }) }) }; },
  };
  return chain;
}
const storage = { from: (bucket: string) => ({
  upload: async (path: string) => { uploads.push({ bucket, path }); return { error: uploadError }; },
  remove: async (paths: string[]) => { removed.push({ bucket, paths }); return { error: null }; },
}) };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from, storage }) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "me", email: null, fullName: null, grants, employeeId: null }) }));

import { addDocument } from "./employeeDocuments";

const E = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const pdf = (name = "scan.pdf") => new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });
const fd = (o: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const idle = { error: null };

beforeEach(() => {
  tables = { employees: [{ id: E, company_id: C }] };
  inserted = []; uploads = []; removed = []; insertError = null; uploadError = null;
  grants = [{ role: "hr_admin", companyId: C, countryCode: null }];
});

describe("addDocument", () => {
  it("refuses a person who is not an HR Admin of the employee's company, whatever the form said", async () => {
    grants = [{ role: "hr_admin", companyId: "33333333-3333-4333-8333-333333333333", countryCode: null }];
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P1", expiryDate: "2030-01-01" }));
    expect(r.error).toMatch(/Only an HR Admin of this employee's company/);
    expect(inserted).toEqual([]);
    grants = [];
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", file: pdf() }))).error).toMatch(/Only an HR Admin/);
    expect(uploads).toEqual([]);
  });

  it("enforces the type's required fields on the server: number, file, expiry", async () => {
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "", expiryDate: "2030-01-01" }))).error).toMatch(/Passport number/);
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01" }))).error).toMatch(/Visa file/);
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", file: pdf() }))).error).toMatch(/Visa expiry/);
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "nonsense" }))).error).toMatch(/Choose a document type/);
    expect(inserted).toEqual([]);
  });

  it("stores identity documents in identity_documents with the number and creator, a scan optional", async () => {
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: " P123 ", expiryDate: "2030-01-01" }));
    expect(r).toEqual({ error: null, saved: { id: NEW, label: "Passport", existing: false } });
    expect(inserted).toEqual([{ table: "identity_documents", row: { employee_id: E, document_type: "passport", document_number: "P123", expiry_date: "2030-01-01", file_path: null, created_by: "me" } }]);
    expect(uploads).toEqual([]);
  });

  it("keeps the identity table's own stored value for 'other'", async () => {
    await addDocument(idle, fd({ employeeId: E, typeKey: "identity:other_identity", number: "X1" }));
    expect(inserted[0]!.row.document_type).toBe("other");
  });

  it("a type that does not expire never stores a date, even if one is posted", async () => {
    await addDocument(idle, fd({ employeeId: E, typeKey: "identity:pesel", number: "90010112345", expiryDate: "2099-01-01" }));
    expect(inserted[0]!.row.expiry_date).toBeNull();
  });

  it("stores other types in employee_documents with a file under the company/employee/type path, derived from the employee record", async () => {
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", file: pdf("my visa.pdf"), submissionId: S, companyId: "44444444-4444-4444-8444-444444444444" }));
    expect(r.saved?.existing).toBe(false);
    expect(uploads).toEqual([{ bucket: "employee-documents", path: `${C}/${E}/visa/${S}-my_visa.pdf` }]);
    expect(inserted).toEqual([{ table: "employee_documents", row: { employee_id: E, document_type: "visa", file_path: `${C}/${E}/visa/${S}-my_visa.pdf`, expiry_date: "2030-01-01" } }]);
  });

  it("removes the uploaded file when the row cannot be saved", async () => {
    insertError = { message: "row-level security" };
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "employee:certificate", file: pdf(), submissionId: S }));
    expect(r.error).toBe("row-level security");
    expect(removed).toEqual([{ bucket: "employee-documents", paths: [`${C}/${E}/certificate/${S}-scan.pdf`] }]);
  });

  it("stops before inserting when the upload fails", async () => {
    uploadError = { message: "bucket down" };
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "employee:certificate", file: pdf(), submissionId: S }))).error).toMatch(/Upload failed: bucket down/);
    expect(inserted).toEqual([]);
  });

  it("a retry of the same submission returns the row it already made, uploading and inserting nothing", async () => {
    tables.employee_documents = [{ id: "old", employee_id: E, file_path: `${C}/${E}/visa/${S}-scan.pdf` }];
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", file: pdf(), submissionId: S }));
    expect(r.saved).toEqual({ id: "old", label: "Visa", existing: true });
    expect(uploads).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it("an identity number with no file is matched on employee, type, number, expiry and creator within two minutes", async () => {
    tables.identity_documents = [{ id: "recent", employee_id: E, document_type: "passport", document_number: "P1", expiry_date: "2030-01-01", created_by: "me", created_at: new Date().toISOString() }];
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P1", expiryDate: "2030-01-01" }));
    expect(r.saved).toEqual({ id: "recent", label: "Passport", existing: true });
    expect(inserted).toEqual([]);
    tables.identity_documents = [{ ...tables.identity_documents![0]!, created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }];
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P1", expiryDate: "2030-01-01" }))).saved?.existing).toBe(false);
  });

  it("a renewal adds a row, only reads the earlier one, and refuses a document that is not this employee's", async () => {
    tables.identity_documents = [{ id: "d1", employee_id: E, document_type: "passport" }];
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P2", expiryDate: "2035-01-01", renewsDocumentId: "00000000-0000-4000-8000-0000000000d1" }));
    expect(r.error).toMatch(/being renewed was not found/);
    tables.identity_documents = [{ id: "00000000-0000-4000-8000-0000000000d1", employee_id: E, document_type: "passport" }];
    const ok = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P2", expiryDate: "2035-01-01", renewsDocumentId: "00000000-0000-4000-8000-0000000000d1" }));
    expect(ok.saved?.existing).toBe(false);
    expect(inserted).toHaveLength(1);
    expect(tables.identity_documents).toHaveLength(1);
  });
});
