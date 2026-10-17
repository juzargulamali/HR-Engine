import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OPP = "22222222-2222-4222-8222-222222222222";
const COMPANY = "11111111-1111-4111-8111-111111111111";
const INTENT = "33333333-3333-4333-8333-333333333333";
const QPATH = `${COMPANY}/${OPP}/${INTENT}-po.pdf`;
const FPATH = `${COMPANY}/${OPP}/44444444-4444-4444-8444-444444444444-po.pdf`;

type AnyFn = (...a: unknown[]) => unknown;
const calls: string[] = [];
const storage: Record<string, Record<string, ReturnType<typeof vi.fn<AnyFn>>>> = {};
const bucket = (name: string) => (storage[name] ??= { createSignedUploadUrl: vi.fn<AnyFn>(), download: vi.fn<AnyFn>(), upload: vi.fn<AnyFn>(), remove: vi.fn<AnyFn>(), createSignedUrl: vi.fn<AnyFn>() });
const adminRpc = vi.fn<AnyFn>();
const userRpc = vi.fn<AnyFn>();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...a: unknown[]) => { calls.push(`admin.rpc:${String(a[0])}:${(a[1] as { p_status?: string })?.p_status ?? ""}`); return adminRpc(...a); },
    storage: { from: (b: string) => {
      const x = bucket(b);
      return {
        createSignedUploadUrl: x.createSignedUploadUrl!,
        download: x.download!,
        upload: (...a: unknown[]) => { calls.push(`upload:${b}`); return x.upload!(...a); },
        remove: (...a: unknown[]) => { calls.push(`remove:${b}`); return x.remove!(...a); },
        createSignedUrl: x.createSignedUrl!,
      };
    } },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...a: unknown[]) => { calls.push(`user.rpc:${String(a[0])}`); return userRpc(...a); }, from: () => ({}) }),
}));

import { finalizeCrmUpload, prepareCrmUpload } from "./crmFiles";

const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)));
const PDF = bytes("%PDF-1.7 test");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const intent = (over: Record<string, unknown> = {}) => ({
  id: INTENT, opportunity_id: OPP, company_id: COMPANY, original_name: "po.pdf", mime_type: "application/pdf", size_bytes: PDF.length, purpose: "purchase_order",
  label: "PO", quarantine_path: QPATH, final_path: FPATH, status: "pending", expires_at: new Date(Date.now() + 3600_000).toISOString(), ...over,
});
const blobOf = (b: Uint8Array) => new Blob([b.slice().buffer as ArrayBuffer]);

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(storage)) delete storage[k];
  adminRpc.mockReset().mockResolvedValue({ data: null, error: null });
  userRpc.mockReset();
});

describe("prepareCrmUpload (nothing is uploaded or recorded unless the declared file is acceptable)", () => {
  const ok = { opportunityId: OPP, name: "po.pdf", size: 1000, type: "application/pdf", purpose: "purchase_order", label: "PO" };
  it("records an intent with a server-side safe name and returns a one-time upload token for the QUARANTINE bucket", async () => {
    userRpc.mockResolvedValue({ data: [{ intent_id: INTENT, quarantine_path: QPATH }], error: null });
    bucket("crm-quarantine").createSignedUploadUrl!.mockResolvedValue({ data: { token: "tok", signedUrl: "https://x", path: QPATH }, error: null });
    const r = await prepareCrmUpload({ ...ok, name: "My PO (final).pdf" });
    expect(r).toEqual({ error: null, intentId: INTENT, path: QPATH, token: "tok" });
    expect(userRpc).toHaveBeenCalledWith("crm_create_upload_intent", expect.objectContaining({ p_original_name: "My PO (final).pdf", p_safe_name: "My_PO_final_.pdf", p_size_bytes: 1000, p_mime_type: "application/pdf" }));
    expect(storage["crm-files"]).toBeUndefined(); // nothing touches the real bucket
  });
  it.each([
    ["an executable", { name: "setup.exe", type: "application/x-msdownload" }],
    ["a macro-enabled workbook", { name: "b.xlsm", type: "application/vnd.ms-excel.sheet.macroEnabled.12" }],
    ["a double extension", { name: "invoice.exe.pdf", type: "application/pdf" }],
    ["a wrong content type", { name: "a.pdf", type: "image/png" }],
    ["an empty file", { size: 0 }],
    ["an oversize file", { size: 20 * 1024 * 1024 + 1 }],
  ])("refuses %s before anything is recorded or signed", async (_l, over) => {
    const r = await prepareCrmUpload({ ...ok, ...over });
    expect(r.error).toBeTruthy();
    expect(userRpc).not.toHaveBeenCalled();
    expect(storage["crm-quarantine"]).toBeUndefined();
  });
  it("accepts a full 20 MB file (well above the 4.5 MB a Vercel function can receive)", async () => {
    userRpc.mockResolvedValue({ data: [{ intent_id: INTENT, quarantine_path: QPATH }], error: null });
    bucket("crm-quarantine").createSignedUploadUrl!.mockResolvedValue({ data: { token: "tok", signedUrl: "https://x", path: QPATH }, error: null });
    expect((await prepareCrmUpload({ ...ok, size: 20 * 1024 * 1024, name: "deck.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })).error).toBeNull();
  });
  it("turns the database's refusal (no access, lost opportunity…) into a plain sentence", async () => {
    userRpc.mockResolvedValue({ data: null, error: { message: "Opportunity not found" } });
    expect(await prepareCrmUpload(ok)).toEqual({ error: "Opportunity not found" });
    expect(storage["crm-quarantine"]).toBeUndefined();
  });
  it("releases the intent if the upload URL cannot be created", async () => {
    userRpc.mockResolvedValue({ data: [{ intent_id: INTENT, quarantine_path: QPATH }], error: null });
    bucket("crm-quarantine").createSignedUploadUrl!.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await prepareCrmUpload(ok)).error).toMatch(/could not be started/);
    expect(adminRpc).toHaveBeenCalledWith("crm_mark_upload_intent", expect.objectContaining({ p_intent_id: INTENT, p_status: "rejected" }));
  });
});

describe("finalizeCrmUpload (a file becomes available only after the server has checked it)", () => {
  function arrives(b: Uint8Array, over: Record<string, unknown> = {}) {
    userRpc.mockImplementation(async (fn: unknown) => (fn === "crm_get_upload_intent" ? { data: [intent(over)], error: null } : { data: "file-id", error: null }));
    bucket("crm-quarantine").download!.mockResolvedValue({ data: blobOf(b), error: null });
    bucket("crm-files").upload!.mockResolvedValue({ error: null });
    bucket("crm-quarantine").remove!.mockResolvedValue({ error: null });
    bucket("crm-files").remove!.mockResolvedValue({ error: null });
  }

  it("validates, then moves into the real bucket, marks validated, clears quarantine, and only then registers", async () => {
    arrives(PDF);
    expect(await finalizeCrmUpload(INTENT)).toEqual({ error: null });
    expect(bucket("crm-files").upload).toHaveBeenCalledWith(FPATH, expect.any(Uint8Array), { contentType: "application/pdf", upsert: false });
    expect(calls.filter((c) => /^(upload|remove|admin\.rpc|user\.rpc:crm_register)/.test(c))).toEqual([
      "upload:crm-files", "admin.rpc:crm_mark_upload_intent:validated", "remove:crm-quarantine", "user.rpc:crm_register_uploaded_file",
    ]);
  });
  it("rejects a file whose real size differs from what was declared, deleting it from quarantine", async () => {
    arrives(PDF, { size_bytes: PDF.length + 5 });
    expect((await finalizeCrmUpload(INTENT)).error).toMatch(/not the size/);
    expect(storage["crm-files"]?.upload).not.toHaveBeenCalled();
    expect(bucket("crm-quarantine").remove).toHaveBeenCalledWith([QPATH]);
    expect(adminRpc).toHaveBeenCalledWith("crm_mark_upload_intent", expect.objectContaining({ p_status: "rejected" }));
    expect(calls).not.toContain("user.rpc:crm_register_uploaded_file");
  });
  it("rejects an executable disguised as a PDF by its own bytes; it never reaches the real bucket", async () => {
    const exe = bytes("MZ\x90\x00 not a pdf");
    arrives(exe, { size_bytes: exe.length });
    expect((await finalizeCrmUpload(INTENT)).error).toMatch(/Executable/);
    expect(storage["crm-files"]?.upload).not.toHaveBeenCalled();
    expect(bucket("crm-quarantine").remove).toHaveBeenCalled();
  });
  it("rejects an Office file that carries a macro project", async () => {
    const macro = bytes("PK\x03\x04", "[Content_Types].xml", "word/document.xml", "word/vbaProject.bin");
    arrives(macro, { original_name: "brief.docx", mime_type: DOCX, size_bytes: macro.length });
    expect((await finalizeCrmUpload(INTENT)).error).toMatch(/macros/);
    expect(storage["crm-files"]?.upload).not.toHaveBeenCalled();
  });
  it("rejects when the stored name or type would not pass the rules even if the database somehow held them", async () => {
    arrives(PDF, { original_name: "invoice.exe.pdf" });
    expect((await finalizeCrmUpload(INTENT)).error).toMatch(/Executable/);
    expect(storage["crm-files"]?.upload).not.toHaveBeenCalled();
  });
  it.each(["rejected", "registered", "expired", "validated"])("does not touch storage for an intent that is already %s", async (status) => {
    userRpc.mockResolvedValue({ data: [intent({ status })], error: null });
    expect((await finalizeCrmUpload(INTENT)).error).toBeTruthy();
    expect(storage["crm-quarantine"]?.download).toBeUndefined();
  });
  it("refuses an expired intent and an unknown intent", async () => {
    userRpc.mockResolvedValue({ data: [intent({ expires_at: new Date(Date.now() - 1000).toISOString() })], error: null });
    expect((await finalizeCrmUpload(INTENT)).error).toMatch(/expired/);
    userRpc.mockResolvedValue({ data: [], error: null });
    expect((await finalizeCrmUpload(INTENT)).error).toMatch(/not found/i);
    expect((await finalizeCrmUpload("nope")).error).toBeTruthy();
  });
  it("asks the person to retry if nothing arrived in quarantine", async () => {
    userRpc.mockResolvedValue({ data: [intent()], error: null });
    bucket("crm-quarantine").download!.mockResolvedValue({ data: null, error: { message: "not found" } });
    expect((await finalizeCrmUpload(INTENT)).error).toMatch(/did not arrive/);
  });
  it("leaves nothing behind when registration is refused after validation", async () => {
    arrives(PDF);
    userRpc.mockImplementation(async (fn: unknown) => (fn === "crm_get_upload_intent" ? { data: [intent()], error: null } : { data: null, error: { message: "A lost opportunity can no longer be updated" } }));
    expect((await finalizeCrmUpload(INTENT)).error).toMatch(/lost opportunity/);
    expect(bucket("crm-files").remove).toHaveBeenCalledWith([FPATH]);
  });
  it("removes both copies if the intent expired while it was being checked", async () => {
    arrives(PDF);
    adminRpc.mockResolvedValue({ data: null, error: { message: "Upload not found, already decided, or expired" } });
    expect((await finalizeCrmUpload(INTENT)).error).toMatch(/expired/);
    expect(bucket("crm-files").remove).toHaveBeenCalledWith([FPATH]);
    expect(bucket("crm-quarantine").remove).toHaveBeenCalledWith([QPATH]);
  });
});
