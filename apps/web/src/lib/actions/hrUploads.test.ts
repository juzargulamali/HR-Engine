import { beforeEach, describe, expect, it, vi } from "vitest";

// Insurance documents and reimbursement receipts: the same three steps as employee documents (prepare, browser upload, check and link), with the same safety properties.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./approvals", () => ({ resolveInitialApprover: vi.fn() }));
vi.mock("./polandTermination", () => ({ applyPolandTerminationLeaveTrueUp: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => { const k = await import("./hrUploadTestKit"); return { createClient: async () => k.serverClient }; });
vi.mock("@/lib/supabase/admin", async () => { const k = await import("./hrUploadTestKit"); return { createAdminClient: () => k.adminClient }; });
vi.mock("@/lib/auth/session", async () => { const k = await import("./hrUploadTestKit"); return { getCurrentSession: async () => k.session() }; });

import { addInsurancePolicy, prepareInsuranceUpload } from "./employees";
import { addClaimLine, prepareReceiptUpload } from "./reimbursements";
import { arrives, bytesOf, pdfBytes, resetWorld, world } from "./hrUploadTestKit";

const E = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMP2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "11111111-1111-4111-8111-111111111111";
const OTHER_C = "33333333-3333-4333-8333-333333333333";
const S = "22222222-2222-4222-8222-222222222222";
const CLAIM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PDF = "application/pdf";
const MB2 = 2 * 1024 * 1024;
const fd = (o: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const idle = { error: null };

beforeEach(() => {
  resetWorld();
  world.tables = {
    employees: [{ id: E, company_id: C, user_id: "me", deleted_at: null }, { id: EMP2, company_id: OTHER_C, user_id: "someone-else", deleted_at: null }],
    reimbursement_claims: [{ id: CLAIM, employee_id: E, status: "draft" }],
  };
  world.grants = [{ role: "hr_admin", companyId: C, countryCode: null }];
});

describe("insurance documents", () => {
  const path = (name = "policy.pdf") => `${C}/${E}/${S}-${name}`;
  const ok = { employeeId: E, submissionId: S, name: "policy.pdf", size: MB2, type: PDF };
  const policy = { employeeId: E, insuranceName: "Fictional Health", policyNumber: "FH-1", expiryDate: "2030-01-01", submissionId: S };
  const withFile = (size = MB2, name = "policy.pdf") => fd({ ...policy, fileName: name, fileType: PDF, fileSize: String(size) });

  it("prepare: authorises the HR Admin from the employee row and signs a link for the private insurance bucket under company/employee", async () => {
    expect(await prepareInsuranceUpload(ok)).toEqual({ error: null, bucket: "insurance-documents", path: path(), token: `tok:${path()}` });
    expect(world.inserted).toEqual([]);
  });
  it("prepare refuses a non-HR user and an HR Admin of another company, signing nothing", async () => {
    world.grants = [];
    expect((await prepareInsuranceUpload(ok)).error).toMatch(/Only an HR Admin/);
    world.grants = [{ role: "hr_admin", companyId: OTHER_C, countryCode: null }];
    expect((await prepareInsuranceUpload(ok)).error).toMatch(/Only an HR Admin/);
    expect(world.storageLog).toEqual([]);
  });
  it.each([
    ["oversize", { size: 10 * 1024 * 1024 + 1 }, /too large/],
    ["a spreadsheet", { name: "p.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, /Only PDF/],
    ["empty", { size: 0 }, /empty/],
  ])("prepare refuses %s", async (_l, over, message) => {
    expect((await prepareInsuranceUpload({ ...ok, ...over })).error).toMatch(message);
    expect(world.storageLog).toEqual([]);
  });

  it("links the 2 MB document after checking it, with the policy saved against the employee", async () => {
    arrives("insurance-documents", path(), pdfBytes(MB2));
    expect(await addInsurancePolicy(idle, withFile())).toEqual({ error: null });
    expect(world.inserted).toEqual([{ table: "employee_insurance_policies", row: { employee_id: E, insurance_name: "Fictional Health", policy_number: "FH-1", expiry_date: "2030-01-01", file_path: path(), created_by: "me" } }]);
  });
  it("a retry creates no second policy and leaves the stored file", async () => {
    arrives("insurance-documents", path(), pdfBytes(MB2));
    await addInsurancePolicy(idle, withFile());
    expect(await addInsurancePolicy(idle, withFile())).toEqual({ error: null });
    expect(world.tables.employee_insurance_policies).toHaveLength(1);
    expect(world.objects.has(`insurance-documents/${path()}`)).toBe(true);
  });
  it("a policy with no document saves without touching storage, and an immediate repeat adds nothing", async () => {
    const none = () => fd({ employeeId: E, insuranceName: "Fictional Health", policyNumber: "FH-1", expiryDate: "2030-01-01" });
    expect(await addInsurancePolicy(idle, none())).toEqual({ error: null });
    expect(await addInsurancePolicy(idle, none())).toEqual({ error: null });
    expect(world.tables.employee_insurance_policies).toHaveLength(1);
    expect(world.storageLog).toEqual([]);
  });
  it("refuses a missing, wrong-size or disguised file and deletes it; nothing is saved", async () => {
    expect((await addInsurancePolicy(idle, withFile())).error).toMatch(/did not arrive/);
    arrives("insurance-documents", path(), pdfBytes(500));
    expect((await addInsurancePolicy(idle, withFile())).error).toMatch(/not the size/);
    const exe = bytesOf("MZ\x90\x00 pretending");
    arrives("insurance-documents", path(), exe);
    expect((await addInsurancePolicy(idle, withFile(exe.length))).error).toMatch(/Executable/);
    expect(world.inserted).toEqual([]);
    expect(world.objects.size).toBe(0);
  });
  it("refuses a non-HR user and an HR Admin of another company, and a form that still posts the bytes", async () => {
    world.grants = [{ role: "hr_admin", companyId: OTHER_C, countryCode: null }];
    expect((await addInsurancePolicy(idle, withFile())).error).toMatch(/Only an HR Admin/);
    world.grants = [{ role: "hr_admin", companyId: C, countryCode: null }];
    expect((await addInsurancePolicy(idle, fd({ ...policy, file: new File([pdfBytes()], "p.pdf", { type: PDF }) }))).error).toMatch(/out of date/);
    expect(world.inserted).toEqual([]);
  });
  it("removes the stored file when the row cannot be saved", async () => {
    arrives("insurance-documents", path(), pdfBytes(MB2));
    world.insertError = { message: "row-level security" };
    expect((await addInsurancePolicy(idle, withFile())).error).toBe("row-level security");
    expect(world.objects.size).toBe(0);
  });
});

describe("reimbursement receipts", () => {
  const path = (name = "taxi.pdf") => `${C}/${E}/receipts/${S}-${name}`;
  const ok = { claimId: CLAIM, submissionId: S, name: "taxi.pdf", size: MB2, type: PDF };
  const line = { claimId: CLAIM, expenseDate: "2026-11-01", category: "travel", amount: "42.50", description: "Taxi", submissionId: S };
  const withReceipt = (size = MB2, name = "taxi.pdf") => fd({ ...line, receiptName: name, receiptType: PDF, receiptSize: String(size) });

  it("prepare: signs a link for the employee's own draft claim under company/employee/receipts, from the database", async () => {
    expect(await prepareReceiptUpload(ok)).toEqual({ error: null, bucket: "receipts", path: path(), token: `tok:${path()}` });
    expect(world.inserted).toEqual([]);
  });
  it("prepare refuses someone else's claim, a claim that is no longer a draft, and a person with no employee record", async () => {
    world.tables.reimbursement_claims = [{ id: CLAIM, employee_id: EMP2, status: "draft" }];
    expect((await prepareReceiptUpload(ok)).error).toBe("That claim was not found.");
    world.tables.reimbursement_claims = [{ id: CLAIM, employee_id: E, status: "submitted" }];
    expect((await prepareReceiptUpload(ok)).error).toMatch(/only be added while the claim is a draft/);
    world.tables.reimbursement_claims = [{ id: CLAIM, employee_id: E, status: "draft" }];
    world.userId = "nobody";
    expect((await prepareReceiptUpload(ok)).error).toMatch(/No employee record/);
    expect(world.storageLog).toEqual([]);
  });
  it.each([
    ["oversize", { size: 10 * 1024 * 1024 + 1 }, /too large/],
    ["a Word file", { name: "r.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, /Only PDF/],
    ["empty", { size: 0 }, /empty/],
  ])("prepare refuses %s", async (_l, over, message) => {
    expect((await prepareReceiptUpload({ ...ok, ...over })).error).toMatch(message);
    expect(world.storageLog).toEqual([]);
  });

  it("adds the line with its receipt (a 2 MB receipt) after checking the stored file", async () => {
    arrives("receipts", path(), pdfBytes(MB2));
    expect(await addClaimLine(idle, withReceipt())).toEqual({ error: null });
    expect(world.inserted).toEqual([{ table: "reimbursement_claim_lines", row: expect.objectContaining({ claim_id: CLAIM, line_no: 1, amount: 42.5, receipt_file_path: path() }) }]);
  });
  it("a retry adds no second line and keeps the receipt", async () => {
    arrives("receipts", path(), pdfBytes(MB2));
    await addClaimLine(idle, withReceipt());
    expect(await addClaimLine(idle, withReceipt())).toEqual({ error: null });
    expect(world.tables.reimbursement_claim_lines).toHaveLength(1);
    expect(world.objects.has(`receipts/${path()}`)).toBe(true);
  });
  it("a line without a receipt saves with no storage call", async () => {
    expect(await addClaimLine(idle, fd(line))).toEqual({ error: null });
    expect(world.inserted[0]!.row.receipt_file_path).toBeNull();
    expect(world.storageLog).toEqual([]);
  });
  it("refuses a line on someone else's claim or a submitted claim before reading storage", async () => {
    arrives("receipts", path(), pdfBytes(MB2));
    world.tables.reimbursement_claims = [{ id: CLAIM, employee_id: EMP2, status: "draft" }];
    expect((await addClaimLine(idle, withReceipt())).error).toBe("That claim was not found.");
    world.tables.reimbursement_claims = [{ id: CLAIM, employee_id: E, status: "pending_approval" }];
    expect((await addClaimLine(idle, withReceipt())).error).toMatch(/draft/);
    expect(world.inserted).toEqual([]);
    expect(world.storageLog.filter((l) => l.startsWith("download"))).toEqual([]);
  });
  it("refuses a missing, wrong-size or disguised receipt and deletes it; no line is added", async () => {
    expect((await addClaimLine(idle, withReceipt())).error).toMatch(/did not arrive/);
    arrives("receipts", path(), pdfBytes(500));
    expect((await addClaimLine(idle, withReceipt())).error).toMatch(/not the size/);
    const exe = bytesOf("MZ\x90\x00 pretending");
    arrives("receipts", path(), exe);
    expect((await addClaimLine(idle, withReceipt(exe.length))).error).toMatch(/Executable/);
    expect(world.inserted).toEqual([]);
    expect(world.objects.size).toBe(0);
  });
  it("refuses a form that still posts the bytes instead of dropping the receipt", async () => {
    expect((await addClaimLine(idle, fd({ ...line, receipt: new File([pdfBytes()], "r.pdf", { type: PDF }) }))).error).toMatch(/out of date/);
    expect(world.inserted).toEqual([]);
  });
  it("removes the stored receipt when the line cannot be added", async () => {
    arrives("receipts", path(), pdfBytes(MB2));
    world.insertError = { message: "row-level security" };
    expect((await addClaimLine(idle, withReceipt())).error).toMatch(/row-level security/);
    expect(world.objects.size).toBe(0);
  });
});
