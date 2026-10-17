import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OPP = "22222222-2222-4222-8222-222222222222";
const COMPANY = "11111111-1111-4111-8111-111111111111";
const upload = vi.fn();
const remove = vi.fn();
const rpc = vi.fn();
let opportunityVisible = true;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ upload, remove, createSignedUrl: vi.fn() }) } }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opportunityVisible ? { id: OPP, company_id: COMPANY } : null }) }) }) }),
    rpc,
  }),
}));

import { uploadCrmFile } from "./crmFiles";

const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)));
function form(file: File | null, extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("id", OPP);
  if (file) fd.set("file", file);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = () => new File([bytes("%PDF-1.7 test")], "po.pdf", { type: "application/pdf" });

describe("uploadCrmFile (server-side validation before anything is stored)", () => {
  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ error: null });
    remove.mockReset().mockResolvedValue({ error: null });
    rpc.mockReset().mockResolvedValue({ data: "file-id", error: null });
    opportunityVisible = true;
  });

  it("stores a valid PDF privately under company/opportunity and registers it", async () => {
    const r = await uploadCrmFile({ error: null }, form(PDF(), { purpose: "purchase_order" }));
    expect(r.error).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, , opts] = upload.mock.calls[0]!;
    expect(path).toMatch(new RegExp(`^${COMPANY}/${OPP}/[0-9a-f-]{36}-po\\.pdf$`));
    expect(opts).toMatchObject({ contentType: "application/pdf", upsert: false });
    expect(rpc).toHaveBeenCalledWith("crm_register_file", expect.objectContaining({ p_kind: "file", p_purpose: "purchase_order", p_mime_type: "application/pdf" }));
  });

  it.each([
    ["an executable", new File([bytes("MZ\x90")], "setup.exe", { type: "application/x-msdownload" })],
    ["a macro-enabled workbook", new File([bytes("PK\x03\x04")], "budget.xlsm", { type: "application/vnd.ms-excel.sheet.macroEnabled.12" })],
    ["a double extension", new File([bytes("%PDF-1.7")], "invoice.exe.pdf", { type: "application/pdf" })],
    ["a script", new File([bytes("alert(1)")], "run.js", { type: "text/javascript" })],
    ["a wrong content type", new File([bytes("%PDF-1.7")], "a.pdf", { type: "image/png" })],
  ])("refuses %s without storing anything", async (_label, file) => {
    const r = await uploadCrmFile({ error: null }, form(file));
    expect(r.error).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a disguised executable (an .exe body named .pdf) by its own bytes", async () => {
    const r = await uploadCrmFile({ error: null }, form(new File([bytes("MZ\x90\x00 real exe")], "report.pdf", { type: "application/pdf" })));
    expect(r.error).toMatch(/Executable/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses a .docx that carries a macro project", async () => {
    const docx = new File([bytes("PK\x03\x04", "[Content_Types].xml", "word/document.xml", "word/vbaProject.bin")], "brief.docx", { type: DOCX });
    const r = await uploadCrmFile({ error: null }, form(docx));
    expect(r.error).toMatch(/macros/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses empty and oversize files", async () => {
    expect((await uploadCrmFile({ error: null }, form(new File([], "a.pdf", { type: "application/pdf" })))).error).toBeTruthy();
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    expect((await uploadCrmFile({ error: null }, form(big))).error).toMatch(/too large/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses when the person cannot see the opportunity (no Sales access to its company)", async () => {
    opportunityVisible = false;
    const r = await uploadCrmFile({ error: null }, form(PDF()));
    expect(r.error).toMatch(/not found/i);
    expect(upload).not.toHaveBeenCalled();
  });

  it("removes the stored object when registration is refused, leaving nothing behind", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only the uploader, the owner or a founder can remove this" } });
    const r = await uploadCrmFile({ error: null }, form(PDF()));
    expect(r.error).toBeTruthy();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]![0]).toEqual([upload.mock.calls[0]![0]]);
  });

  it("does not accept a missing file or opportunity", async () => {
    expect((await uploadCrmFile({ error: null }, form(null))).error).toMatch(/Choose a file/);
    const fd = new FormData();
    fd.set("file", PDF());
    expect((await uploadCrmFile({ error: null }, fd)).error).toMatch(/Missing opportunity/);
  });
});
