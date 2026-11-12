import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

/** Fictional project and people. The database is a stand-in: one recorded rpc and two table reads. */
const ID = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();
let stockError: { message: string } | null = null;
const table = (name: string) => {
  const rows = name === "inv_items" ? [{ id: "s-led", name: "LED panel P2.6", status: "active" }] : [{ id: "f1", label: "Wall sketch", original_name: "sketch.png" }];
  const answer = { data: name === "inv_items" && stockError ? null : rows, error: name === "inv_items" ? stockError : null };
  const q: Record<string, unknown> = { then: (ok: (v: typeof answer) => unknown) => Promise.resolve(answer).then(ok) };
  for (const m of ["select", "eq", "neq", "in", "order", "range"]) q[m] = () => q;
  return q;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from: table }) }));

let ctx: unknown = null;
let view: unknown = null;
let viewThrows = false;
vi.mock("@/lib/projects/context", () => ({ getProjectsContext: async () => ctx }));
vi.mock("@/lib/projects/data", () => ({
  loadProjectView: async () => { if (viewThrows) throw new Error("down"); return view; },
  memberOptions: (v: { people: { user_id: string; full_name: string }[] }) => v.people.map((p) => ({ id: p.user_id, name: p.full_name })),
}));
let planRead: unknown = null;
vi.mock("@/lib/projects/delivery-plan/data", () => ({ loadDeliveryPlan: async () => planRead }));

import { GET as templateGet } from "@/app/api/projects/[id]/delivery-plan/template/route";
import { GET as exportGet } from "@/app/api/projects/[id]/delivery-plan/export/route";
import { POST as importPost } from "@/app/api/projects/[id]/delivery-plan/import/route";

const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const member = { level: "details", project: { id: ID, company_id: "c1", status: "active", reference: "PRJ/AE 0042" }, people: [{ user_id: "u-ada", full_name: "Ada Fixture" }] };
const plan = {
  rev: 3, can_manage: true, my_sections: [], delegations: [], corrections: [], changes: [],
  items: [{ id: "i1", key: "D001", zone: "Entrance", title: "Welcome wall", specs: null, owner_id: "u-ada", owner_name: "Ada Fixture", needed_by: "2027-03-01", image_file_id: "f1", released_at: null, version: 1, sort_order: 0,
    lines: [{ id: "l1", key: "L0001", section: "hardware", description: "LED panels", qty: 24, inv_item_id: "s-led", inv_item_name: "LED panel P2.6", assignee_id: null, assignee_name: null, needed_by: null, notes: null, released_at: null, version: 1, task: null, equipment: null }] }],
};
const get = () => new Request("http://x/api");
const upload = (file: File, fields: Record<string, string> = {}) => { const f = new FormData(); f.set("file", file); for (const [k, v] of Object.entries(fields)) f.set(k, v); return new Request("http://x/api", { method: "POST", body: f }); };
async function sheet(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Deliverables");
  ws.addRow(["Deliverable ID", "Zone", "Deliverable", "Specifications", "Accountable owner", "Needed by"]); for (const r of rows) ws.addRow(r);
  return new File([new Uint8Array(await wb.xlsx.writeBuffer())], "plan.xlsx");
}

beforeEach(() => { ctx = { userId: "u-ada" }; view = member; viewThrows = false; planRead = { state: "ok", plan }; stockError = null; rpc.mockReset(); revalidatePath.mockReset(); });

describe("template and export routes", () => {
  it("need a signed-in person who can read the project's details", async () => {
    for (const route of [templateGet, exportGet]) {
      ctx = null; expect((await route(get(), params())).status).toBe(401);
      ctx = { userId: "u", loadFailed: true }; expect((await route(get(), params())).status).toBe(503);
      ctx = { userId: "u" }; view = null; expect((await route(get(), params())).status).toBe(404);
      expect((await route(get(), params("not-an-id"))).status).toBe(404);
      view = { ...member, level: "summary" }; expect((await route(get(), params())).status).toBe(403);
      view = member; viewThrows = true; expect((await route(get(), params())).status).toBe(503);
      viewThrows = false;
    }
    const ok = await templateGet(get(), params());
    expect(ok.headers.get("content-disposition")).toBe('attachment; filename="delivery-plan-template.xlsx"');
  });
  it("exports the plan under a file name from the project reference, with member, image and stock names", async () => {
    const r = await exportGet(get(), params());
    expect(r.headers.get("content-type")).toMatch(/spreadsheetml/);
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="delivery-plan-PRJ-AE-0042.xlsx"');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as never);
    expect(wb.getWorksheet("Deliverables")!.getCell("G2").value).toBe("Wall sketch");
    expect(wb.getWorksheet("Breakdown")!.getCell("H2").value).toBe("LED panel P2.6");
  });
  it("says it could not load, and sends no partial file, when the plan cannot be read; it does not need the stock list", async () => {
    planRead = { state: "error" };
    const a = await exportGet(get(), params());
    expect(a.status).toBe(503); expect((await a.json()).error).toMatch(/Could not load the Delivery plan/);
    // The stock item names travel with the plan, so the export does not depend on the person being able to read the stock list.
    planRead = { state: "ok", plan }; stockError = { message: "boom" };
    expect((await exportGet(get(), params())).status).toBe(200);
    planRead = { state: "denied" }; expect((await exportGet(get(), params())).status).toBe(403);
  });
});

describe("import route", () => {
  it("refuses an oversized upload, a missing file and an unauthorised caller", async () => {
    expect((await importPost(upload(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "a.xlsx")), params())).status).toBe(413);
    const none = new FormData(); none.set("mode", "preview");
    expect((await importPost(new Request("http://x/api", { method: "POST", body: none }), params())).status).toBe(400);
    const file = await sheet([["", "Lobby", "Kiosk", "", "", ""]]);
    ctx = null; expect((await importPost(upload(file), params())).status).toBe(401);
    ctx = { userId: "u" }; view = null; expect((await importPost(upload(file), params())).status).toBe(404);
    view = { ...member, project: { ...member.project, status: "completed" } }; expect((await importPost(upload(file, { mode: "confirm", rev: "3" }), params())).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("previews without writing, then confirms with the rev and the answers, and refreshes the Projects pages", async () => {
    const file = await sheet([["", "Lobby", "Kiosk", "", "Someone Else", ""]]);
    const preview = await (await importPost(upload(file), params())).json();
    expect(preview).toMatchObject({ ok: true, mode: "preview", rev: 3, summary: { attention: 1 } });
    expect(rpc).not.toHaveBeenCalled(); expect(revalidatePath).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { added: 1, updated: 0, proposed: 0, unchanged: 0, rev: 4 }, error: null });
    const blocked = await importPost(upload(file, { mode: "confirm", rev: "3", resolutions: "not json" }), params());
    expect(blocked.status).toBe(409); expect((await blocked.json()).code).toBe("needs_attention");
    const done = await importPost(upload(file, { mode: "confirm", rev: "3", resolutions: JSON.stringify({ "Deliverables!2:owner": "u-ada" }) }), params());
    expect(await done.json()).toMatchObject({ ok: true, mode: "confirm", counts: { added: 1 } });
    expect(rpc).toHaveBeenCalledWith("proj_dp_apply_import", { p_project_id: ID, p_expected_rev: 3, p_items: [{ ref: "Deliverables!2", id: null, fields: { zone: "Lobby", title: "Kiosk", owner_id: "u-ada" } }], p_lines: [] });
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    const stale = await importPost(upload(file, { mode: "confirm", rev: "2", resolutions: JSON.stringify({ "Deliverables!2:owner": "skip" }) }), params());
    expect(stale.status).toBe(409); expect((await stale.json()).code).toBe("preview_stale");
  });
});
