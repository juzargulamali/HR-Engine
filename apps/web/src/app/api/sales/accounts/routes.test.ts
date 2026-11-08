import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { buildDirectoryRows } from "@/lib/crm/clients-agencies/directory";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: vi.fn() }) }));

const CO = "11111111-1111-4111-8111-111111111111";
let ctx: unknown = null;
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));
const loadDirectory = vi.fn();
const loadStaff = vi.fn();
const loadSummaryInputs = vi.fn();
vi.mock("@/lib/crm/clients-agencies/data", () => ({ loadDirectory: (...a: unknown[]) => loadDirectory(...a), loadStaff: () => loadStaff(), loadSummaryInputs: (...a: unknown[]) => loadSummaryInputs(...a) }));

import { GET as exportGet } from "./export/route";
import { GET as templateGet } from "./import/template/route";
import { POST as importPost } from "./import/route";

const granted = { userId: "u", grants: [{ companyId: CO, capabilities: [] }], companies: [{ id: CO, name: "Fixture LLC" }] };
const row = (name: string, country: string | null) => ({ org: { id: name, name, roles: [], country_code: country, website: null, place: null, note: null }, contacts: [], profile: null, stats: null, relationship: null });
const get = (qs: string) => exportGet(new Request(`http://x/api/sales/accounts/export?${qs}`));

beforeEach(() => {
  ctx = granted;
  loadDirectory.mockReset().mockResolvedValue([row("Fixture A", "AE"), row("Fixture B", "QA")]);
  loadStaff.mockReset().mockResolvedValue([]);
  loadSummaryInputs.mockReset().mockResolvedValue({ companyId: CO, opportunities: [], proposals: [], zoho: [], activities: [], projects: { status: "ok", data: [] } });
});

describe("export route", () => {
  it("refuses the signed-out, a failed access read, and a company the person has no grant for", async () => {
    ctx = null; expect((await get(`company=${CO}`)).status).toBe(401);
    ctx = { ...granted, loadFailed: true }; expect((await get(`company=${CO}`)).status).toBe(503);
    ctx = granted; expect((await get("company=22222222-2222-4222-8222-222222222222")).status).toBe(403);
    expect(loadDirectory).not.toHaveBeenCalled();
  });
  it("says it could not load when a read fails, and never sends a partial file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    loadSummaryInputs.mockRejectedValue(new Error("down"));
    const r = await get(`company=${CO}&scope=all`);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/Could not load/);
  });
  it("exports everything for scope=all and only the filtered accounts for scope=filtered", async () => {
    const count = async (qs: string) => {
      const r = await get(qs);
      expect(r.headers.get("content-type")).toMatch(/spreadsheetml/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as never);
      expect(wb.worksheets.map((w) => w.name)).toEqual(["Organisations", "Summary (read-only)"]);
      return wb.getWorksheet("Organisations")!.rowCount - 1;
    };
    expect(await count(`company=${CO}&scope=all&country=AE`)).toBe(2);
    expect(await count(`company=${CO}&scope=filtered&country=AE`)).toBe(1);
    expect(loadDirectory).toHaveBeenCalledWith(CO);
  });
});

describe("export of filtered results honours the relationship filter, search and role", () => {
  const org = (id: string, name: string, roles: string[]) => ({ id, name, roles, country_code: "AE", website: null, website_domain: null, place: null, note: null, archived_at: null } as never);
  const opp = (id: string, orgId: string, stage: string, created_at: string) => ({ id, company_id: CO, agency_org_id: null, client_org_id: orgId, stage, created_at }) as never;
  const rows = buildDirectoryRows({
    organisations: [org("a", "Fixture Won Agency", ["agency"]), org("b", "Fixture Won Client", ["client"]), org("c", "Fixture Quiet Agency", ["agency"]), org("d", "Fixture Stale Agency", ["agency"])],
    contacts: [], profiles: [], companyId: CO, now: new Date("2026-11-08T08:00:00Z"),
    opportunities: [opp("1", "a", "won", "2026-11-01T08:00:00Z"), opp("2", "b", "won", "2026-11-01T08:00:00Z"), opp("3", "c", "new", "2026-11-01T08:00:00Z"), opp("4", "d", "lost", "2026-01-01T08:00:00Z")],
  });
  const names = async (qs: string) => {
    const r = await get(`company=${CO}&scope=filtered&${qs}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as never);
    const ws = wb.getWorksheet("Organisations")!;
    return ws.getColumn(1).values.slice(2).map(String).sort();
  };
  beforeEach(() => { loadDirectory.mockResolvedValue(rows); });
  it("rel alone, rel with role, rel with search", async () => {
    expect(await names("rel=won")).toEqual(["Fixture Won Agency", "Fixture Won Client"]);
    expect(await names("rel=won&role=agency")).toEqual(["Fixture Won Agency"]);
    expect(await names("rel=won&q=client")).toEqual(["Fixture Won Client"]);
    expect(await names("rel=no_wins")).toEqual(["Fixture Quiet Agency"]);
    expect(await names("rel=dormant")).toEqual(["Fixture Stale Agency"]);
    expect(await names("role=agency")).toEqual(["Fixture Quiet Agency", "Fixture Stale Agency", "Fixture Won Agency"]);
  });
  it("export all ignores the relationship filter", async () => {
    const r = await get(`company=${CO}&scope=all&rel=won`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as never);
    expect(wb.getWorksheet("Organisations")!.rowCount - 1).toBe(4);
  });
  it("a relationship filter is refused (not silently dropped) when the enquiries could not be read", async () => {
    loadDirectory.mockResolvedValue(buildDirectoryRows({ organisations: [org("a", "Fixture Won Agency", ["agency"])], contacts: [], profiles: [], companyId: CO, opportunities: null }));
    const r = await get(`company=${CO}&scope=filtered&rel=won`);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/relationship filter cannot be applied/);
    expect((await get(`company=${CO}&scope=filtered&role=agency`)).status).toBe(200);
  });
});

describe("template and import routes", () => {
  it("the template needs a signed-in person with Sales access", async () => {
    ctx = null; expect((await templateGet()).status).toBe(401);
    ctx = { ...granted, grants: [] }; expect((await templateGet()).status).toBe(403);
    ctx = granted; expect((await templateGet()).headers.get("content-disposition")).toMatch(/template\.xlsx/);
  });
  it("the import route refuses an unauthorised caller and an oversized upload", async () => {
    const form = (file: File, companyId = CO) => { const f = new FormData(); f.set("file", file); f.set("companyId", companyId); f.set("mode", "confirm"); return new Request("http://x/api/sales/accounts/import", { method: "POST", body: f }); };
    ctx = null;
    expect((await importPost(form(new File([new Uint8Array(10)], "a.xlsx")))).status).toBe(401);
    ctx = granted;
    expect((await importPost(form(new File([new Uint8Array(10)], "a.xlsx"), "22222222-2222-4222-8222-222222222222"))).status).toBe(403);
    expect((await importPost(form(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "a.xlsx")))).status).toBe(413);
    expect(loadDirectory).not.toHaveBeenCalled();
  });
});
