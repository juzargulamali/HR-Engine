import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => { const k = await import("./hrUploadTestKit"); return { createClient: async () => k.serverClient }; });
vi.mock("@/lib/supabase/admin", async () => { const k = await import("./hrUploadTestKit"); return { createAdminClient: () => k.adminClient }; });
vi.mock("@/lib/auth/session", async () => { const k = await import("./hrUploadTestKit"); return { getCurrentSession: async () => k.session() }; });

import { addDocument, attachIdentityFile, prepareDocumentUpload, prepareIdentityFileUpload } from "./employeeDocuments";
import { arrives, bytesOf, pdfBytes, resetWorld, world } from "./hrUploadTestKit";

const E = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C = "11111111-1111-4111-8111-111111111111";
const OTHER_C = "33333333-3333-4333-8333-333333333333";
const S = "22222222-2222-4222-8222-222222222222";
const D = "00000000-0000-4000-8000-0000000000d1";
const PDF = "application/pdf";
const fd = (o: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
/** The fields the form posts for a file it has already sent to private storage: name, type and size, never the bytes. */
const declared = (name = "scan.pdf", size = 64, type = PDF) => ({ fileName: name, fileType: type, fileSize: String(size) });
const idle = { error: null };
const visaPath = (name = "scan.pdf") => `${C}/${E}/visa/${S}-${name}`;

beforeEach(() => {
  resetWorld();
  world.tables = { employees: [{ id: E, company_id: C }] };
  world.grants = [{ role: "hr_admin", companyId: C, countryCode: null }];
});

describe("prepareDocumentUpload (authorised from the database; nothing recorded)", () => {
  const ok = { employeeId: E, typeKey: "employee:visa", submissionId: S, name: "my visa.pdf", size: 2 * 1024 * 1024, type: PDF };

  it("signs a one-time link for the private employee-documents bucket under the employee's own company/employee/type path, even for a 2 MB scan", async () => {
    const r = await prepareDocumentUpload(ok);
    expect(r).toEqual({ error: null, bucket: "employee-documents", path: `${C}/${E}/visa/${S}-my_visa.pdf`, token: `tok:${C}/${E}/visa/${S}-my_visa.pdf` });
    expect(world.inserted).toEqual([]);
  });
  it("uses the identity bucket and the stored type value for identity documents", async () => {
    const r = await prepareDocumentUpload({ ...ok, typeKey: "identity:other_identity" });
    expect(r).toMatchObject({ bucket: "identity-documents", path: `${C}/${E}/other/${S}-my_visa.pdf` });
  });
  it("refuses a person who is not an HR Admin of the employee's company, and an HR Admin of another company, without signing anything", async () => {
    world.grants = [];
    expect((await prepareDocumentUpload(ok)).error).toMatch(/Only an HR Admin/);
    world.grants = [{ role: "line_manager", companyId: C, countryCode: null }];
    expect((await prepareDocumentUpload(ok)).error).toMatch(/Only an HR Admin/);
    world.grants = [{ role: "hr_admin", companyId: OTHER_C, countryCode: null }];
    expect((await prepareDocumentUpload({ ...ok, typeKey: "identity:passport" })).error).toMatch(/Only an HR Admin/);
    expect(world.storageLog).toEqual([]);
  });
  it("refuses an employee the person cannot see (another company's employee row is not visible to them)", async () => {
    world.tables.employees = [];
    expect((await prepareDocumentUpload(ok)).error).toBe("Employee not found.");
    expect(world.storageLog).toEqual([]);
  });
  it.each([
    ["an oversize file", { size: 10 * 1024 * 1024 + 1 }, /too large/],
    ["an empty file", { size: 0 }, /empty/],
    ["a Word file", { name: "a.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, /Only PDF, JPEG, PNG, or WebP/],
    ["an executable", { name: "setup.exe", type: "application/x-msdownload" }, /Only PDF, JPEG, PNG, or WebP/],
    ["a double extension", { name: "invoice.exe.pdf" }, /Executable/],
    ["a name that does not match its type", { name: "a.png" }, /does not match/],
  ])("refuses %s before anything is signed", async (_l, over, message) => {
    expect((await prepareDocumentUpload({ ...ok, ...over })).error).toMatch(message);
    expect(world.storageLog).toEqual([]);
  });
  it("accepts a file of exactly 10 MB", async () => {
    expect((await prepareDocumentUpload({ ...ok, size: 10 * 1024 * 1024 })).error).toBeNull();
  });
  it("needs the form's one-time id, the type and a real employee id", async () => {
    expect((await prepareDocumentUpload({ ...ok, submissionId: "nope" })).error).toMatch(/out of date/);
    expect((await prepareDocumentUpload({ ...ok, typeKey: "nonsense" })).error).toMatch(/Choose a document type/);
    expect((await prepareDocumentUpload({ ...ok, employeeId: "x" })).error).toMatch(/could not be identified/);
  });
  it("on a retry whose file is already stored, signs nothing and says so (the browser then skips the upload)", async () => {
    arrives("employee-documents", visaPath("my_visa.pdf"), pdfBytes());
    expect(await prepareDocumentUpload(ok)).toMatchObject({ error: null, token: null });
    expect(world.storageLog).toEqual([]);
  });
  it("turns a signing failure into a plain sentence", async () => {
    world.signFails = true;
    expect((await prepareDocumentUpload(ok)).error).toMatch(/could not be started/);
  });
});

describe("addDocument", () => {
  it("refuses a person who is not an HR Admin of the employee's company, whatever the form said", async () => {
    world.grants = [{ role: "hr_admin", companyId: OTHER_C, countryCode: null }];
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P1", expiryDate: "2030-01-01" }));
    expect(r.error).toMatch(/Only an HR Admin of this employee's company/);
    expect(world.inserted).toEqual([]);
    world.grants = [];
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", ...declared(), submissionId: S }))).error).toMatch(/Only an HR Admin/);
    expect(world.storageLog).toEqual([]);
  });

  it("enforces the type's required fields on the server: number, file, expiry", async () => {
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "", expiryDate: "2030-01-01" }))).error).toMatch(/Passport number/);
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01" }))).error).toMatch(/Visa file/);
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", ...declared(), submissionId: S }))).error).toMatch(/Visa expiry/);
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "nonsense" }))).error).toMatch(/Choose a document type/);
    expect(world.inserted).toEqual([]);
  });

  it("stores identity documents in identity_documents with the number and creator, a scan optional", async () => {
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: " P123 ", expiryDate: "2030-01-01" }));
    expect(r).toEqual({ error: null, saved: { id: "new-1", label: "Passport", existing: false } });
    expect(world.inserted).toEqual([{ table: "identity_documents", row: { employee_id: E, document_type: "passport", document_number: "P123", expiry_date: "2030-01-01", file_path: null, created_by: "me" } }]);
    expect(world.storageLog).toEqual([]);
  });

  it("keeps the identity table's own stored value for 'other'", async () => {
    await addDocument(idle, fd({ employeeId: E, typeKey: "identity:other_identity", number: "X1" }));
    expect(world.inserted[0]!.row.document_type).toBe("other");
  });

  it("a type that does not expire never stores a date, even if one is posted", async () => {
    await addDocument(idle, fd({ employeeId: E, typeKey: "identity:pesel", number: "90010112345", expiryDate: "2099-01-01" }));
    expect(world.inserted[0]!.row.expiry_date).toBeNull();
  });

  it("links a file that is already in private storage: checks the real file, then saves the row under the company/employee/type path derived from the employee record", async () => {
    arrives("employee-documents", visaPath("my_visa.pdf"), pdfBytes(2 * 1024 * 1024));
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", ...declared("my visa.pdf", 2 * 1024 * 1024), submissionId: S, companyId: "44444444-4444-4444-8444-444444444444" }));
    expect(r.saved?.existing).toBe(false);
    expect(world.inserted).toEqual([{ table: "employee_documents", row: { employee_id: E, document_type: "visa", file_path: visaPath("my_visa.pdf"), expiry_date: "2030-01-01" } }]);
    expect(world.objects.has(`employee-documents/${visaPath("my_visa.pdf")}`)).toBe(true);
  });

  it("a 2 MB Emirates ID scan is saved with its file, not as 'No file attached'", async () => {
    const path = `${C}/${E}/emirates_id/${S}-eid.pdf`;
    arrives("identity-documents", path, pdfBytes(2 * 1024 * 1024));
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:emirates_id", number: "784-0000-0000000-0", expiryDate: "2030-01-01", ...declared("eid.pdf", 2 * 1024 * 1024), submissionId: S }));
    expect(r.saved?.existing).toBe(false);
    expect(world.inserted[0]!.row).toMatchObject({ document_type: "emirates_id", file_path: path });
  });

  it("refuses to save when the file never arrived, saving nothing", async () => {
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "employee:certificate", ...declared(), submissionId: S }));
    expect(r.error).toMatch(/did not arrive/);
    expect(world.inserted).toEqual([]);
  });

  it("refuses a stored file whose real size differs from the declared one, and deletes it", async () => {
    arrives("employee-documents", visaPath(), pdfBytes(5000));
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", ...declared("scan.pdf", 100), submissionId: S }));
    expect(r.error).toMatch(/not the size/);
    expect(world.inserted).toEqual([]);
    expect(world.objects.has(`employee-documents/${visaPath()}`)).toBe(false);
  });

  it("refuses an oversize stored file that was declared small, and deletes it", async () => {
    arrives("employee-documents", visaPath(), pdfBytes(10 * 1024 * 1024 + 5));
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", ...declared("scan.pdf", 1000), submissionId: S }));
    expect(r.error).toMatch(/not the size/);
    expect(world.inserted).toEqual([]);
    expect(world.objects.size).toBe(0);
  });

  it("refuses an executable that was sent under a PDF name, by its own bytes, and deletes it", async () => {
    const exe = bytesOf("MZ\x90\x00 pretending");
    arrives("employee-documents", visaPath(), exe);
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", ...declared("scan.pdf", exe.length), submissionId: S }));
    expect(r.error).toMatch(/Executable/);
    expect(world.inserted).toEqual([]);
    expect(world.objects.size).toBe(0);
  });

  it("refuses a declared type or size outside the displayed limits before looking at storage", async () => {
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", ...declared("a.docx", 10, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), submissionId: S }))).error).toMatch(/Only PDF/);
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", ...declared("a.pdf", 11 * 1024 * 1024), submissionId: S }))).error).toMatch(/too large/);
    expect(world.storageLog).toEqual([]);
  });

  it("refuses a form from before the change that still posts the file's bytes, instead of saving the row without its file", async () => {
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P1", expiryDate: "2030-01-01", file: new File([pdfBytes()], "scan.pdf", { type: PDF }) }));
    expect(r.error).toMatch(/out of date/);
    expect(world.inserted).toEqual([]);
  });

  it("removes the stored file when the row cannot be saved", async () => {
    arrives("employee-documents", `${C}/${E}/certificate/${S}-scan.pdf`, pdfBytes());
    world.insertError = { message: "row-level security" };
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "employee:certificate", ...declared(), submissionId: S }));
    expect(r.error).toBe("row-level security");
    expect(world.storageLog).toContain(`remove:employee-documents/${C}/${E}/certificate/${S}-scan.pdf`);
    expect(world.objects.size).toBe(0);
  });

  it("a retry of the same submission returns the row it already made: no second row, and the stored file is left alone", async () => {
    arrives("employee-documents", visaPath(), pdfBytes());
    const form = () => fd({ employeeId: E, typeKey: "employee:visa", expiryDate: "2030-01-01", ...declared(), submissionId: S });
    const first = await addDocument(idle, form());
    const again = await addDocument(idle, form());
    expect(first.saved?.existing).toBe(false);
    expect(again.saved).toEqual({ id: first.saved!.id, label: "Visa", existing: true });
    expect(world.inserted).toHaveLength(1);
    expect(world.objects.has(`employee-documents/${visaPath()}`)).toBe(true);
    expect(world.storageLog.filter((l) => l.startsWith("remove"))).toEqual([]);
  });

  it("an identity number with no file is matched on employee, type, number, expiry and creator within two minutes", async () => {
    world.tables.identity_documents = [{ id: "recent", employee_id: E, document_type: "passport", document_number: "P1", expiry_date: "2030-01-01", created_by: "me", created_at: new Date().toISOString() }];
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P1", expiryDate: "2030-01-01" }));
    expect(r.saved).toEqual({ id: "recent", label: "Passport", existing: true });
    expect(world.inserted).toEqual([]);
    world.tables.identity_documents = [{ ...world.tables.identity_documents![0]!, created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }];
    expect((await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P1", expiryDate: "2030-01-01" }))).saved?.existing).toBe(false);
  });

  it("a renewal adds a row, only reads the earlier one, and refuses a document that is not this employee's", async () => {
    world.tables.identity_documents = [{ id: "d1", employee_id: E, document_type: "passport" }];
    const r = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P2", expiryDate: "2035-01-01", renewsDocumentId: D }));
    expect(r.error).toMatch(/being renewed was not found/);
    world.tables.identity_documents = [{ id: D, employee_id: E, document_type: "passport" }];
    const ok = await addDocument(idle, fd({ employeeId: E, typeKey: "identity:passport", number: "P2", expiryDate: "2035-01-01", renewsDocumentId: D }));
    expect(ok.saved?.existing).toBe(false);
    expect(world.inserted).toHaveLength(1);
    expect(world.tables.identity_documents).toHaveLength(2);
  });
});

describe("Attach file to an identity document that has none", () => {
  const path = (name = "eid.pdf", type = "emirates_id") => `${C}/${E}/${type}/${S}-${name}`;
  const base = { documentId: D, submissionId: S, name: "eid.pdf", size: 2 * 1024 * 1024, type: PDF };
  beforeEach(() => {
    world.tables.identity_documents = [{ id: D, employee_id: E, document_type: "emirates_id", document_number: "784-1", expiry_date: "2031-05-01", file_path: null, created_by: "someone" }];
  });

  it("prepare: authorised from the document's own employee, signs a link under the document's company/employee/type path", async () => {
    expect(await prepareIdentityFileUpload(base)).toEqual({ error: null, bucket: "identity-documents", path: path(), token: `tok:${path()}` });
    expect(world.inserted).toEqual([]);
    expect(world.updated).toEqual([]);
  });
  it("prepare and attach refuse a non-HR user and an HR Admin of another company, signing and changing nothing", async () => {
    for (const grants of [[], [{ role: "line_manager", companyId: C, countryCode: null }], [{ role: "hr_admin", companyId: OTHER_C, countryCode: null }]]) {
      world.grants = grants;
      expect((await prepareIdentityFileUpload(base)).error).toMatch(/Only an HR Admin/);
      expect((await attachIdentityFile(base)).error).toMatch(/Only an HR Admin/);
    }
    expect(world.storageLog).toEqual([]);
    expect(world.updated).toEqual([]);
  });
  it("refuses a document the person cannot see", async () => {
    world.tables.identity_documents = [];
    expect((await prepareIdentityFileUpload(base)).error).toBe("That document was not found.");
    expect((await attachIdentityFile(base)).error).toBe("That document was not found.");
  });
  it.each([
    ["oversize", { size: 10 * 1024 * 1024 + 1 }],
    ["a Word file", { name: "a.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }],
    ["empty", { size: 0 }],
  ])("refuses %s before signing or reading anything", async (_l, over) => {
    expect((await prepareIdentityFileUpload({ ...base, ...over })).error).toBeTruthy();
    expect((await attachIdentityFile({ ...base, ...over })).error).toBeTruthy();
    expect(world.storageLog).toEqual([]);
  });

  it("attaches the file to THAT SAME row: only file_path changes, the id, number and dates stay", async () => {
    arrives("identity-documents", path(), pdfBytes(2 * 1024 * 1024));
    expect(await attachIdentityFile(base)).toEqual({ error: null, attached: true });
    expect(world.updated).toEqual([{ table: "identity_documents", patch: { file_path: path() }, id: D }]);
    expect(world.tables.identity_documents).toEqual([{ id: D, employee_id: E, document_type: "emirates_id", document_number: "784-1", expiry_date: "2031-05-01", file_path: path(), created_by: "someone" }]);
    expect(world.inserted).toEqual([]);
  });
  it("uses the stored 'other' type value for an other identity document", async () => {
    world.tables.identity_documents![0]!.document_type = "other";
    expect(await prepareIdentityFileUpload(base)).toMatchObject({ path: path("eid.pdf", "other") });
  });
  it("a retry after a lost answer succeeds without changing anything again and keeps the file", async () => {
    arrives("identity-documents", path(), pdfBytes(2 * 1024 * 1024));
    await attachIdentityFile(base);
    expect(await prepareIdentityFileUpload(base)).toMatchObject({ error: null, token: null });
    expect(await attachIdentityFile(base)).toEqual({ error: null, attached: true });
    expect(world.updated).toHaveLength(1);
    expect(world.objects.has(`identity-documents/${path()}`)).toBe(true);
  });
  it("refuses a document that already has a different file, and removes the new upload", async () => {
    world.tables.identity_documents![0]!.file_path = `${C}/${E}/emirates_id/old-scan.pdf`;
    expect((await prepareIdentityFileUpload(base)).error).toMatch(/already has a file/);
    arrives("identity-documents", path(), pdfBytes(2 * 1024 * 1024));
    expect((await attachIdentityFile(base)).error).toMatch(/already has a file/);
    expect(world.updated).toEqual([]);
  });
  it("only fills an empty file_path: a file attached in the meantime is never overwritten, and the new upload is removed", async () => {
    arrives("identity-documents", path(), pdfBytes(2 * 1024 * 1024));
    // someone else attached while this upload was in flight: the update is conditional on file_path still being empty
    const original = world.tables.identity_documents![0]!;
    const row = new Proxy(original, { get: (t, k) => (k === "file_path" && world.storageLog.some((l) => l.startsWith("download:")) ? `${C}/${E}/emirates_id/other.pdf` : t[k as string]) });
    world.tables.identity_documents = [row];
    expect((await attachIdentityFile(base)).error).toMatch(/already has a file/);
    expect(world.objects.has(`identity-documents/${path()}`)).toBe(false);
  });
  it("refuses a file that never arrived, a wrong-size file and a disguised executable, attaching nothing", async () => {
    expect((await attachIdentityFile(base)).error).toMatch(/did not arrive/);
    arrives("identity-documents", path(), pdfBytes(4000));
    expect((await attachIdentityFile(base)).error).toMatch(/not the size/);
    const exe = bytesOf("MZ\x90\x00 pretending");
    arrives("identity-documents", path(), exe);
    expect((await attachIdentityFile({ ...base, size: exe.length })).error).toMatch(/Executable/);
    expect(world.updated).toEqual([]);
    expect(world.objects.size).toBe(0);
  });
});
