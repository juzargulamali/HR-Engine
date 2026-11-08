import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const update = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ update: (v: unknown) => { update(v); return { eq: () => ({ select: async () => ({ data: [{ id: "x" }], error: null }) }) }; } }) }),
}));
import { updateCompanyIssuerDetails } from "./companies";

const CO = "11111111-1111-4111-8111-111111111111";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const base = { companyId: CO, legalName: "Fictional Works LLC", trn: "900100200300009", address: "", phone: "", email: "", website: "" };
beforeEach(() => update.mockClear());

describe("issuer details (fictional values)", () => {
  it("keeps an address with several lines, stored with plain line breaks (a browser submits CRLF)", async () => {
    const r = await updateCompanyIssuerDetails({ error: null }, fd({ ...base, address: "Fictional Tower, Level 4\r\nFictional Bay, Dubai 00000" }));
    expect(r.error).toBeNull();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ address: "Fictional Tower, Level 4\nFictional Bay, Dubai 00000", trn: "900100200300009" }));
  });
  it("stores phone, email and website exactly as typed, and empty fields as null (so nothing blank is printed)", async () => {
    await updateCompanyIssuerDetails({ error: null }, fd({ ...base, phone: "+000 11 222 3333", email: "sales@fictional.example", website: "www.fictional.example" }));
    expect(update).toHaveBeenCalledWith({ legal_name: "Fictional Works LLC", trn: "900100200300009", address: null, phone: "+000 11 222 3333", email: "sales@fictional.example", website: "www.fictional.example" });
    update.mockClear();
    await updateCompanyIssuerDetails({ error: null }, fd({ ...base, trn: "" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ trn: null, phone: null, email: null, website: null }));
  });
  it("a blank legal name is refused", async () => {
    expect((await updateCompanyIssuerDetails({ error: null }, fd({ ...base, legalName: " " }))).error).toMatch(/Legal name/);
    expect(update).not.toHaveBeenCalled();
  });
});
