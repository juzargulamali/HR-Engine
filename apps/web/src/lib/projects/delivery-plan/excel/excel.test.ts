import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryPlan, DpItem, DpLine, DpSection } from "../model";
import { parseDeliveryPlanWorkbook } from "./parse";
import { ONLY_PM, NO_STOCK_LIST, WITH_WAREHOUSE, effectiveStatus, parseSection, planDeliveryImport, willPropose, type Named, type PayloadItem, type PayloadLine } from "./plan";
import { PREVIEW_STALE, runDeliveryPlanImport, type DpImportDeps, type DpImportRequest } from "./service";
import { BREAKDOWN_HEADERS, BREAKDOWN_SHEET, DELIVERABLES_SHEET, DELIVERABLE_HEADERS, buildDeliveryPlanExport, buildDeliveryPlanTemplate } from "./workbook";

/** Everything here is fictional: people, items, zones and the project. */
const PROJECT = "11111111-1111-4111-8111-111111111111";
const COMPANY = "22222222-2222-4222-8222-222222222222";
const PEOPLE: Named[] = [
  { id: "u-ada", name: "Ada Fixture" }, { id: "u-ben", name: "Ben Sample" }, { id: "u-sam1", name: "Sam Twin" }, { id: "u-sam2", name: "Sam Twin" },
];
const STOCK: Named[] = [{ id: "s-led", name: "LED panel P2.6" }, { id: "s-led-out", name: "LED panel P3.9 outdoor" }, { id: "s-pc", name: "Media server" }, { id: "s-dup1", name: "Touch frame" }, { id: "s-dup2", name: "Touch frame" }];

type Cell = string | number | Date | null;
type Sheets = { deliverables?: Cell[][]; breakdown?: Cell[][]; deliverableHeaders?: string[]; breakdownHeaders?: string[] };
async function workbook(s: Sheets): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  if (s.deliverables) { const ws = wb.addWorksheet(DELIVERABLES_SHEET); ws.addRow(s.deliverableHeaders ?? [...DELIVERABLE_HEADERS]); for (const r of s.deliverables) ws.addRow(r); }
  if (s.breakdown) { const ws = wb.addWorksheet(BREAKDOWN_SHEET); ws.addRow(s.breakdownHeaders ?? [...BREAKDOWN_HEADERS]); for (const r of s.breakdown) ws.addRow(r); }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const emptyPlan = (over: Partial<DeliveryPlan> = {}): DeliveryPlan => ({ rev: 0, can_manage: true, my_sections: [], delegations: [], items: [], corrections: [], changes: [], ...over });
const line = (key: string, section: DpSection, description: string, over: Partial<DpLine> = {}): DpLine => ({
  id: `id-${key}`, key, section, description, qty: null, inv_item_id: null, assignee_id: null, assignee_name: null, needed_by: null, notes: null, released_at: null, version: 1, task: null, equipment: null, ...over,
});
const item = (key: string, zone: string, title: string, over: Partial<DpItem> = {}): DpItem => ({
  id: `id-${key}`, key, zone, title, specs: null, owner_id: null, owner_name: null, needed_by: null, image_file_id: null, released_at: null, version: 1, sort_order: 0, lines: [], ...over,
});

/**
 * A simulated database: holds one plan, records every `proj_dp_apply_import` call, and applies it the way the migration does (new keys, name matching, released rows
 * become proposals, the revision check). Enough to prove that a second import of the same workbook finds nothing to do.
 */
function simulatedDb(start: DeliveryPlan = emptyPlan()) {
  const state = { plan: structuredClone(start), proposals: [] as { target: string; fields: Record<string, unknown> }[] };
  const calls: { p_project_id: string; p_expected_rev: number; p_items: PayloadItem[]; p_lines: PayloadLine[] }[] = [];
  const nameOf = (id: unknown) => PEOPLE.find((p) => p.id === id)?.name ?? null;
  const rpc = vi.fn(async (_fn: string, args: { p_project_id: string; p_expected_rev: number; p_items: unknown; p_lines: unknown }) => {
    const a = args as (typeof calls)[number];
    calls.push(structuredClone(a));
    if (a.p_expected_rev !== state.plan.rev) return { data: null, error: { message: "The plan changed after this preview was prepared. Upload the workbook again to see a fresh preview", code: "40001" } };
    const plan = state.plan; const refs = new Map<string, DpItem>(); const out = { added: 0, updated: 0, proposed: 0, unchanged: 0 };
    for (const r of a.p_items) {
      const f = r.fields;
      let it = r.id ? plan.items.find((i) => i.id === r.id) : plan.items.find((i) => i.zone.toLowerCase() === String(f.zone ?? "").toLowerCase() && i.title.toLowerCase() === String(f.title).toLowerCase());
      if (!it) {
        const key = `D${String(plan.items.length + 1).padStart(3, "0")}`;
        it = item(key, String(f.zone ?? ""), String(f.title), { specs: (f.specs as string) ?? null, owner_id: (f.owner_id as string) ?? null, owner_name: nameOf(f.owner_id), needed_by: (f.needed_by as string) ?? null });
        plan.items.push(it); out.added++;
      } else if (it.released_at) { state.proposals.push({ target: it.key, fields: f }); out.proposed++; }
      else if (r.id) {
        if ("zone" in f) it.zone = String(f.zone); if ("title" in f) it.title = String(f.title); if ("specs" in f) it.specs = String(f.specs);
        if ("owner_id" in f) { it.owner_id = String(f.owner_id); it.owner_name = nameOf(f.owner_id); } if ("needed_by" in f) it.needed_by = String(f.needed_by);
        out.updated++;
      } else out.unchanged++;
      refs.set(r.ref, it);
    }
    for (const r of a.p_lines) {
      const it = r.item_id ? plan.items.find((i) => i.id === r.item_id) : refs.get(r.item_ref ?? "");
      if (!it) return { data: null, error: { message: "A breakdown line refers to a deliverable that is not in the plan or the workbook" } };
      const f = r.fields;
      let ln = r.id ? it.lines.find((l) => l.id === r.id) : it.lines.find((l) => l.section === f.section && l.description.toLowerCase() === String(f.description).toLowerCase());
      if (!ln) {
        const n = plan.items.reduce((c, i) => c + i.lines.length, 0) + 1;
        ln = line(`L${String(n).padStart(4, "0")}`, f.section as DpSection, String(f.description), {
          qty: (f.qty as number) ?? null, inv_item_id: (f.inv_item_id as string) ?? null, assignee_id: (f.assignee_id as string) ?? null, assignee_name: nameOf(f.assignee_id), needed_by: (f.needed_by as string) ?? null, notes: (f.notes as string) ?? null,
        });
        it.lines.push(ln); out.added++;
      } else if (ln.released_at) { state.proposals.push({ target: ln.key, fields: f }); out.proposed++; }
      else if (r.id) {
        if ("description" in f) ln.description = String(f.description); if ("qty" in f) ln.qty = Number(f.qty); if ("inv_item_id" in f) ln.inv_item_id = String(f.inv_item_id);
        if ("assignee_id" in f) { ln.assignee_id = String(f.assignee_id); ln.assignee_name = nameOf(f.assignee_id); } if ("needed_by" in f) ln.needed_by = String(f.needed_by); if ("notes" in f) ln.notes = String(f.notes);
        out.updated++;
      } else out.unchanged++;
    }
    plan.rev += 1;
    return { data: { ...out, rev: plan.rev }, error: null };
  });
  const deps = (over: Partial<DpImportDeps> = {}): DpImportDeps => ({
    db: { rpc } as never, signedIn: true, project: { id: PROJECT, companyId: COMPANY, status: "active", level: "details" },
    loadPlan: async () => ({ state: "ok", plan: structuredClone(state.plan) }), loadPeople: async () => PEOPLE, loadInventoryItems: async () => STOCK, ...over,
  });
  return { state, calls, rpc, deps };
}
const req = (bytes: Uint8Array, over: Partial<DpImportRequest> = {}): DpImportRequest => ({ fileName: "plan.xlsx", bytes, mode: "preview", ...over });
async function planOf(bytes: Uint8Array, plan: DeliveryPlan, extra: { inventory?: Named[] | null; resolutions?: Record<string, string> } = {}) {
  const parsed = await parseDeliveryPlanWorkbook(bytes, "plan.xlsx");
  if (!parsed.ok) throw new Error(parsed.error);
  return planDeliveryImport({ workbook: parsed.file, plan, people: PEOPLE, inventory: extra.inventory === undefined ? STOCK : extra.inventory, resolutions: extra.resolutions });
}
async function ok<M extends "preview" | "confirm">(p: ReturnType<typeof runDeliveryPlanImport>, mode: M) {
  const r = await p;
  if (!r.ok || r.mode !== mode) throw new Error(`expected a ${mode}, got ${JSON.stringify(r)}`);
  return r as Extract<typeof r, { ok: true; mode: M }>;
}
const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
const exhibition = () => workbook({
  deliverables: [
    ["", "Entrance", "Interactive LED welcome wall", "3 m x 2 m, touch overlay", "Ada Fixture", D(2027, 3, 1)],
    ["", "Entrance", "Reception counter screen", "", "Ben Sample", "2027-03-02"],
    ["", "Main hall", "Projection table", "Round, 1.6 m", "ada fixture", D(2027, 3, 5)],
    ["", "Theatre", "Immersive film room", "", "", ""],
  ],
  breakdown: [
    ["", "", "Entrance", "Interactive LED welcome wall", "Hardware", "LED panels", 24, "LED panel P2.6", "", D(2027, 2, 20), "Spare modules included"],
    ["", "", "Entrance", "Interactive LED welcome wall", "content / ui / ux", "Welcome animation", "", "", "Ben Sample", "2027-02-25", ""],
    ["", "", "entrance", "interactive led welcome wall", "PROGRAMMING", "Touch logic", "", "", "Ada Fixture", "", ""],
    ["", "", "Main hall", "Projection table", "Installation", "Mount the projector", 1, "", "", "", ""],
    ["", "", "Main hall", "Projection table", "testing", "Full run-through", "", "", "", D(2027, 3, 4), ""],
    ["", "", "Theatre", "Immersive film room", "Hardware", "Media server", 2, "Media server", "", "", ""],
  ],
});

describe("1. an integrated exhibition job", () => {
  it("adds every deliverable and line, and lines name their new deliverable by item_ref", async () => {
    const p = await planOf(await exhibition(), emptyPlan());
    expect(p.summary).toEqual({ add: 10, update: 0, unchanged: 0, attention: 0 });
    expect(p.payload.items).toEqual([
      { ref: "Deliverables!2", id: null, fields: { zone: "Entrance", title: "Interactive LED welcome wall", specs: "3 m x 2 m, touch overlay", owner_id: "u-ada", needed_by: "2027-03-01" } },
      { ref: "Deliverables!3", id: null, fields: { zone: "Entrance", title: "Reception counter screen", owner_id: "u-ben", needed_by: "2027-03-02" } },
      { ref: "Deliverables!4", id: null, fields: { zone: "Main hall", title: "Projection table", specs: "Round, 1.6 m", owner_id: "u-ada", needed_by: "2027-03-05" } },
      { ref: "Deliverables!5", id: null, fields: { zone: "Theatre", title: "Immersive film room" } },
    ]);
    expect(p.payload.lines).toEqual([
      { item_ref: "Deliverables!2", item_id: null, id: null, fields: { section: "hardware", description: "LED panels", qty: 24, inv_item_id: "s-led", needed_by: "2027-02-20", notes: "Spare modules included" } },
      { item_ref: "Deliverables!2", item_id: null, id: null, fields: { section: "content", description: "Welcome animation", assignee_id: "u-ben", needed_by: "2027-02-25" } },
      { item_ref: "Deliverables!2", item_id: null, id: null, fields: { section: "programming", description: "Touch logic", assignee_id: "u-ada" } },
      { item_ref: "Deliverables!4", item_id: null, id: null, fields: { section: "installation", description: "Mount the projector", qty: 1 } },
      { item_ref: "Deliverables!4", item_id: null, id: null, fields: { section: "testing", description: "Full run-through", needed_by: "2027-03-04" } },
      { item_ref: "Deliverables!5", item_id: null, id: null, fields: { section: "hardware", description: "Media server", qty: 2, inv_item_id: "s-pc" } },
    ]);
  });
  it("previews without writing, then confirms the same batch through the database function", async () => {
    const db = simulatedDb();
    const bytes = await exhibition();
    const preview = await ok(runDeliveryPlanImport(db.deps(), req(bytes)), "preview");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(preview).toMatchObject({ rev: 0, summary: { add: 10, attention: 0 }, fileRows: { deliverables: 4, breakdown: 6 } });
    const done = await ok(runDeliveryPlanImport(db.deps(), req(bytes, { mode: "confirm", rev: preview.rev })), "confirm");
    expect(done.counts).toEqual({ added: 10, updated: 0, proposed: 0, unchanged: 0 });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({ p_project_id: PROJECT, p_expected_rev: 0 });
    expect(db.state.plan.items.map((i) => [i.key, i.title, i.lines.map((l) => l.key)])).toEqual([
      ["D001", "Interactive LED welcome wall", ["L0001", "L0002", "L0003"]], ["D002", "Reception counter screen", []], ["D003", "Projection table", ["L0004", "L0005"]], ["D004", "Immersive film room", ["L0006"]],
    ]);
  });
  it("accepts the section names in any case and the long label", () => {
    expect(["Hardware", "CONTENT", "Content / UI / UX", "content/ui/ux", "programming", " Installation ", "testing"].map(parseSection)).toEqual(["hardware", "content", "content", "content", "programming", "installation", "testing"]);
    expect(parseSection("Lighting")).toBeNull();
  });
});

describe("2. a simple supply-and-install job", () => {
  it("imports a workbook that has only the Deliverables sheet, with no errors", async () => {
    const bytes = await workbook({ deliverables: [["", "", "Supply 12 display screens", "55 inch", "", ""], ["", "", "Install the screens", "", "Ben Sample", "2027-01-15"], ["", "", "Hand over and train the client", "", "", ""]] });
    const db = simulatedDb();
    const preview = await ok(runDeliveryPlanImport(db.deps(), req(bytes)), "preview");
    expect(preview.summary).toEqual({ add: 3, update: 0, unchanged: 0, attention: 0 });
    expect(preview.rows.flatMap((r) => r.issues)).toEqual([]);
    const done = await ok(runDeliveryPlanImport(db.deps(), req(bytes, { mode: "confirm", rev: 0 })), "confirm");
    expect(done.counts.added).toBe(3);
    expect(db.calls[0]!.p_lines).toEqual([]);
    expect(db.state.plan.items.map((i) => i.title)).toEqual(["Supply 12 display screens", "Install the screens", "Hand over and train the client"]);
  });
});

/** A plan that exists already: two deliverables, one with lines. */
const existingPlan = (over: Partial<DeliveryPlan> = {}) => emptyPlan({
  rev: 7,
  items: [
    item("D001", "Entrance", "Interactive LED welcome wall", { specs: "3 m x 2 m", owner_id: "u-ada", owner_name: "Ada Fixture", needed_by: "2027-03-01", lines: [
      line("L0001", "hardware", "LED panels", { qty: 24, inv_item_id: "s-led", needed_by: "2027-02-20" }),
      line("L0002", "content", "Welcome animation", { assignee_id: "u-ben", assignee_name: "Ben Sample", needed_by: "2027-02-25", notes: "Brand film as the base" }),
    ] }),
    item("D002", "Main hall", "Projection table", { needed_by: "2027-03-05" }),
  ],
  ...over,
});
const stockNames = Object.fromEntries(STOCK.map((s) => [s.id, s.name]));
async function editExport(plan: DeliveryPlan, edit: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildDeliveryPlanExport(plan, PEOPLE, {}, stockNames)) as unknown as ArrayBuffer);
  edit(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("3. export, edit, import again", () => {
  it("exports the plan in the template's shape, with the read-only columns filled", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildDeliveryPlanExport(existingPlan(), PEOPLE, { f1: "Wall sketch" }, stockNames)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Deliverables", "Breakdown", "Instructions"]);
    const items = wb.getWorksheet("Deliverables")!;
    expect((items.getRow(1).values as unknown[]).slice(1)).toEqual([...DELIVERABLE_HEADERS, "Reference image", "Released (read-only)", "Progress (read-only)"]);
    expect((items.getRow(2).values as unknown[]).slice(1)).toEqual(["D001", "Entrance", "Interactive LED welcome wall", "3 m x 2 m", "Ada Fixture", D(2027, 3, 1), undefined, "No", "2 draft lines, nothing released"]);
    const lines = wb.getWorksheet("Breakdown")!;
    expect((lines.getRow(2).values as unknown[]).slice(1)).toEqual(["L0001", "D001", "Entrance", "Interactive LED welcome wall", "Hardware", "LED panels", 24, "LED panel P2.6", undefined, D(2027, 2, 20), undefined, "No", "Draft: not released"]);
  });
  it("an untouched export is all Unchanged", async () => {
    const p = await planOf(await editExport(existingPlan(), () => undefined), existingPlan());
    expect(p.summary).toEqual({ add: 0, update: 0, unchanged: 4, attention: 0 });
    expect(p.payload).toEqual({ items: [], lines: [] });
  });
  it("an untouched export is Unchanged even for someone who cannot read the stock list, or when the stock item has been retired", async () => {
    const named = (): DeliveryPlan => { const p = existingPlan(); for (const i of p.items) for (const l of i.lines) if (l.inv_item_id) l.inv_item_name = stockNames[l.inv_item_id] ?? "LED panel P2.6"; return p; };
    const file = await editExport(named(), () => undefined);
    for (const inventory of [[] as Named[], null]) {
      const p = await planOf(file, named(), { inventory });
      expect(p.summary).toEqual({ add: 0, update: 0, unchanged: 4, attention: 0 });
      expect(p.payload).toEqual({ items: [], lines: [] });
    }
  });
  it("a changed name and a changed date are Updates of the same rows, found by ID; nothing is added", async () => {
    const bytes = await editExport(existingPlan(), (wb) => {
      wb.getWorksheet("Deliverables")!.getCell("C2").value = "LED welcome wall with touch";
      wb.getWorksheet("Deliverables")!.getCell("F3").value = D(2027, 3, 9);
      wb.getWorksheet("Breakdown")!.getCell("F3").value = "Welcome film";
    });
    const p = await planOf(bytes, existingPlan());
    expect(p.summary).toEqual({ add: 0, update: 3, unchanged: 1, attention: 0 });
    expect(p.payload.items).toEqual([
      { ref: "Deliverables!2", id: "id-D001", fields: { title: "LED welcome wall with touch" } },
      { ref: "Deliverables!3", id: "id-D002", fields: { needed_by: "2027-03-09" } },
    ]);
    // The Breakdown sheet still shows the deliverable's old name: the Line ID decides, not the name.
    expect(p.payload.lines).toEqual([{ item_ref: null, item_id: "id-D001", id: "id-L0002", fields: { description: "Welcome film" } }]);
    expect(p.rows.find((r) => r.row === 2 && r.sheet === "Deliverables")!.changes).toEqual([{ field: "Deliverable", from: "Interactive LED welcome wall", to: "LED welcome wall with touch" }]);
  });
  it("a row without an ID that names an existing deliverable or line updates it instead of adding a second", async () => {
    const bytes = await workbook({
      deliverables: [["", " entrance ", "INTERACTIVE LED WELCOME WALL", "", "", "2027-03-03"]],
      breakdown: [["", "D001", "", "", "Hardware", "led panels", 30, "", "", "", ""], ["", "", "Entrance", "Interactive LED welcome wall", "Content", "Welcome animation", "", "", "", "", ""]],
    });
    const p = await planOf(bytes, existingPlan());
    expect(p.summary).toMatchObject({ add: 0, attention: 0 });
    expect(p.payload.items).toEqual([{ ref: "Deliverables!2", id: "id-D001", fields: { zone: "entrance", title: "INTERACTIVE LED WELCOME WALL", needed_by: "2027-03-03" } }]);
    expect(p.payload.lines).toEqual([{ item_ref: null, item_id: "id-D001", id: "id-L0001", fields: { description: "led panels", qty: 30 } }]);
  });
  it("an ID that is not in this project's plan, a duplicate row and a name clash need attention", async () => {
    const bytes = await workbook({
      deliverables: [["D099", "Entrance", "Something", "", "", ""], ["D001", "", "", "", "", "2027-04-01"], ["d001", "", "", "", "", "2027-04-02"], ["D002", "Entrance", "Interactive LED welcome wall", "", "", ""]],
      breakdown: [["L9999", "", "", "", "Hardware", "Ghost", "", "", "", "", ""], ["L0001", "D002", "", "", "Content", "", "", "", "", "", ""]],
    });
    const p = await planOf(bytes, existingPlan());
    const issues = p.rows.map((r) => [r.sheet, r.row, r.status, r.issues.map((i) => `${i.field}: ${i.message}`).join(" | ")]);
    expect(issues[0]![3]).toMatch(/Deliverable ID: D099: this ID is not in this project's plan/);
    expect(issues[1]![2]).toBe("update");
    expect(issues[2]![3]).toMatch(/same deliverable as row 3/);
    expect(issues[3]![3]).toMatch(/Another deliverable in this zone already has that name/);
    expect(issues[4]![3]).toMatch(/Line ID: L9999: this ID is not in this project's plan/);
    expect(issues[5]![3]).toMatch(/cannot be moved to another deliverable.*cannot be moved to another section/);
    expect(p.payload.items.map((i) => i.id)).toEqual(["id-D001"]);
    expect(p.payload.lines).toEqual([]);
  });
});

describe("4. importing the same workbook twice", () => {
  it("the second time everything is Unchanged, the payload is empty and the database is not called", async () => {
    const db = simulatedDb();
    const bytes = await exhibition();
    await ok(runDeliveryPlanImport(db.deps(), req(bytes, { mode: "confirm", rev: 0 })), "confirm");
    const again = await ok(runDeliveryPlanImport(db.deps(), req(bytes)), "preview");
    expect(again.summary).toEqual({ add: 0, update: 0, unchanged: 10, attention: 0 });
    expect(again.rows).toEqual([]);
    expect((await planOf(bytes, db.state.plan)).payload).toEqual({ items: [], lines: [] });
    const confirm = await ok(runDeliveryPlanImport(db.deps(), req(bytes, { mode: "confirm", rev: again.rev })), "confirm");
    expect(confirm).toMatchObject({ nothingToDo: true, counts: { added: 0, updated: 0, proposed: 0, unchanged: 10 } });
    expect(db.calls).toHaveLength(1);                                         // only the first import reached the database
    expect(db.state.plan.items).toHaveLength(4);
  });
});

/** Released: the hardware line is on a request the warehouse already has (a reservation exists); the content line has its task. */
const releasedPlan = () => existingPlan({
  items: [
    item("D001", "Entrance", "Interactive LED welcome wall", { owner_id: "u-ada", owner_name: "Ada Fixture", needed_by: "2027-03-01", released_at: "2026-11-01T08:00:00Z", lines: [
      line("L0001", "hardware", "LED panels", { qty: 24, inv_item_id: "s-led", needed_by: "2027-02-20", released_at: "2026-11-01T08:00:00Z",
        equipment: { request_id: "r1", request_code: "REQ-0001", request_status: "submitted", line_status: "open", qty: 24, reserved: 24, dispatched: 0, returned: 0 } }),
      line("L0002", "content", "Welcome animation", { assignee_id: "u-ben", assignee_name: "Ben Sample", needed_by: "2027-02-25", released_at: "2026-11-01T08:00:00Z",
        task: { id: "t1", title: "Welcome animation", status: "in_progress", due_date: "2027-02-25", blocked: false, assignee_name: "Ben Sample" } }),
      line("L0003", "hardware", "Touch overlay", { qty: 1, inv_item_id: "s-dup1", released_at: "2026-11-01T08:00:00Z", equipment: { request_id: "r2", request_code: "REQ-0002", request_status: "draft", line_status: "open", qty: 1 } }),
    ] }),
  ],
});

describe("5. a released plan with a reservation", () => {
  it("a changed Quantity on booked equipment needs attention and is never sent; a changed date on a released work line is flagged as a proposal", async () => {
    const bytes = await editExport(releasedPlan(), (wb) => {
      const b = wb.getWorksheet("Breakdown")!;
      b.getCell("G2").value = 30;                        // L0001 quantity: booked
      b.getCell("J3").value = D(2027, 3, 1);             // L0002 needed by: released work line
      b.getCell("G4").value = 2;                         // L0003 quantity: released, but its request is still a draft
      wb.getWorksheet("Deliverables")!.getCell("F2").value = D(2027, 3, 8);
    });
    const p = await planOf(bytes, releasedPlan());
    const row = (key: string) => p.rows.find((r) => r.key === key)!;
    expect(row("L0001")).toMatchObject({ status: "attention", issues: [{ field: "Quantity", message: WITH_WAREHOUSE }] });
    expect(row("L0002")).toMatchObject({ status: "update", released: true, proposes: true });
    expect(willPropose(row("L0002"), {})).toBe(true);
    expect(willPropose(row("L0003"), {})).toBe(true);
    expect(willPropose(row("D001"), {})).toBe(true);
    expect(p.payload.lines).toEqual([
      { item_ref: null, item_id: "id-D001", id: "id-L0002", fields: { needed_by: "2027-03-01" } },
      { item_ref: null, item_id: "id-D001", id: "id-L0003", fields: { qty: 2 } },
    ]);
    expect(JSON.stringify(p.payload)).not.toContain("id-L0001");
  });
  it("blocks confirm while the booked row is in the file; without it the released changes go to the database as proposals", async () => {
    const db = simulatedDb(releasedPlan());
    const blocked = await editExport(releasedPlan(), (wb) => { wb.getWorksheet("Breakdown")!.getCell("H2").value = "Media server"; });
    expect(await runDeliveryPlanImport(db.deps(), req(blocked, { mode: "confirm", rev: 7 }))).toMatchObject({ ok: false, status: 409, code: "needs_attention" });
    expect(db.rpc).not.toHaveBeenCalled();
    const fine = await editExport(releasedPlan(), (wb) => { const b = wb.getWorksheet("Breakdown")!; b.spliceRows(2, 1); b.getCell("J2").value = D(2027, 3, 1); });
    const done = await ok(runDeliveryPlanImport(db.deps(), req(fine, { mode: "confirm", rev: 7 })), "confirm");
    expect(done.counts).toMatchObject({ added: 0, updated: 0, proposed: 1 });
    expect(db.state.proposals).toEqual([{ target: "L0002", fields: { needed_by: "2027-03-01" } }]);
    expect(db.state.plan.items[0]!.lines[1]!.needed_by).toBe("2027-02-25");  // the released line itself did not change
  });
  it("a note on a released line is a direct change, not a proposal, and an untouched released export is Unchanged", async () => {
    const p = await planOf(await editExport(releasedPlan(), (wb) => { wb.getWorksheet("Breakdown")!.getCell("K3").value = "Use the new logo"; }), releasedPlan());
    expect(p.summary).toEqual({ add: 0, update: 1, unchanged: 3, attention: 0 });
    expect(willPropose(p.rows.find((r) => r.key === "L0002")!, {})).toBe(false);
  });
});

describe("6. blank cells and missing rows", () => {
  it("never produce a clear or a delete", async () => {
    // D002 and L0002 are missing from the workbook; every cell except one is blank on the rows that are there.
    const bytes = await workbook({ deliverables: [["D001", "", "", "", "", ""]], breakdown: [["L0001", "", "", "", "", "", "", "", "", "", "Check the pixel pitch"]] });
    const p = await planOf(bytes, existingPlan());
    expect(p.summary).toEqual({ add: 0, update: 1, unchanged: 1, attention: 0 });
    expect(p.payload).toEqual({ items: [], lines: [{ item_ref: null, item_id: "id-D001", id: "id-L0001", fields: { notes: "Check the pixel pitch" } }] });
    const sent = JSON.stringify(p.payload);
    expect(sent).not.toMatch(/null,"fields"|:""|:null}/);
    const db = simulatedDb(existingPlan());
    await ok(runDeliveryPlanImport(db.deps(), req(bytes, { mode: "confirm", rev: 7 })), "confirm");
    expect(db.state.plan.items.map((i) => i.key)).toEqual(["D001", "D002"]);
    expect(db.state.plan.items[0]).toMatchObject({ specs: "3 m x 2 m", owner_id: "u-ada", needed_by: "2027-03-01" });
    expect(db.state.plan.items[0]!.lines.map((l) => [l.key, l.qty, l.inv_item_id, l.notes])).toEqual([["L0001", 24, "s-led", "Check the pixel pitch"], ["L0002", null, null, "Brand film as the base"]]);
  });
});

describe("7. names that are unknown or ambiguous", () => {
  const bytes = () => workbook({
    deliverables: [["D001", "", "", "", "Sam Twin", ""], ["D002", "", "", "", "Jordan Nobody", ""]],
    breakdown: [["L0001", "", "", "", "", "", "", "Touch frame", "", "", ""], ["", "D002", "", "", "Hardware", "Projector", 1, "LED panel", "", "", ""], ["", "D002", "", "", "Hardware", "Cables", "", "Fog machine", "", "", ""]],
  });
  it("asks for an explicit choice, with the candidates, under a stable ref", async () => {
    const p = await planOf(await bytes(), existingPlan());
    expect(p.summary).toEqual({ add: 0, update: 0, unchanged: 0, attention: 5 });
    expect(p.payload).toEqual({ items: [], lines: [] });
    const choices = p.rows.flatMap((r) => r.choices);
    expect(choices.map((c) => [c.ref, c.reason, c.candidates.map((x) => x.id)])).toEqual([
      ["Deliverables!2:owner", "ambiguous", ["u-sam1", "u-sam2"]],
      ["Deliverables!3:owner", "unknown", ["u-ada", "u-ben", "u-sam1", "u-sam2"]],
      ["Breakdown!2:stock", "ambiguous", ["s-dup1", "s-dup2"]],
      ["Breakdown!3:stock", "unknown", ["s-led", "s-led-out"]],
      ["Breakdown!4:stock", "unknown", []],
    ]);
    expect(choices[0]!.message).toMatch(/ambiguous/);
  });
  it("a chosen id is sent, skip leaves the field alone, and an answer that is not a candidate does not count", async () => {
    const resolutions = { "Deliverables!2:owner": "u-sam2", "Deliverables!3:owner": "skip", "Breakdown!2:stock": "skip", "Breakdown!3:stock": "s-led-out", "Breakdown!4:stock": "skip" };
    const p = await planOf(await bytes(), existingPlan(), { resolutions });
    expect(p.summary).toEqual({ add: 2, update: 1, unchanged: 2, attention: 0 });
    expect(p.payload.items).toEqual([{ ref: "Deliverables!2", id: "id-D001", fields: { owner_id: "u-sam2" } }]);
    expect(p.payload.lines).toEqual([
      { item_ref: null, item_id: "id-D002", id: null, fields: { section: "hardware", description: "Projector", qty: 1, inv_item_id: "s-led-out" } },
      { item_ref: null, item_id: "id-D002", id: null, fields: { section: "hardware", description: "Cables" } },
    ]);
    // the screen uses the same rule on the preview rows
    const preview = await planOf(await bytes(), existingPlan());
    expect(preview.rows.map((r) => effectiveStatus(r, resolutions))).toEqual(p.rows.map((r) => r.status));
    const forged = await planOf(await bytes(), existingPlan(), { resolutions: { ...resolutions, "Deliverables!2:owner": "u-ada" } });
    expect(forged.rows[0]!.status).toBe("attention");
  });
  it("an unanswered choice blocks confirm; answered, the import goes through", async () => {
    const db = simulatedDb(existingPlan());
    const file = await bytes();
    expect(await runDeliveryPlanImport(db.deps(), req(file, { mode: "confirm", rev: 7, resolutions: { "Deliverables!2:owner": "u-sam1" } }))).toMatchObject({ ok: false, status: 409, code: "needs_attention" });
    expect(db.rpc).not.toHaveBeenCalled();
    const done = await ok(runDeliveryPlanImport(db.deps(), req(file, { mode: "confirm", rev: 7, resolutions: { "Deliverables!2:owner": "u-sam1", "Deliverables!3:owner": "skip", "Breakdown!2:stock": "s-dup2", "Breakdown!3:stock": "skip", "Breakdown!4:stock": "skip" } })), "confirm");
    expect(done.counts).toEqual({ added: 2, updated: 2, proposed: 0, unchanged: 1 });
    expect(db.state.plan.items[0]).toMatchObject({ owner_id: "u-sam1" });
    expect(db.state.plan.items[1]!.owner_id).toBeNull();
    expect(db.state.plan.items[0]!.lines[0]!.inv_item_id).toBe("s-dup2");
  });
  it("a preview ignores answers sent with it, and a stock item is never silently dropped when the stock list could not be loaded", async () => {
    const db = simulatedDb(existingPlan());
    const preview = await ok(runDeliveryPlanImport(db.deps({ loadInventoryItems: async () => null }), req(await bytes(), { resolutions: { "Deliverables!2:owner": "u-sam1" } })), "preview");
    expect(preview.summary.attention).toBe(5);
    const stock = preview.rows.filter((r) => r.sheet === "Breakdown").map((r) => r.issues);
    expect(stock).toEqual([[{ field: "Stock item", message: NO_STOCK_LIST }], [{ field: "Stock item", message: NO_STOCK_LIST }], [{ field: "Stock item", message: NO_STOCK_LIST }]]);
    const thrown = await ok(runDeliveryPlanImport(db.deps({ loadInventoryItems: async () => { throw new Error("down"); } }), req(await bytes())), "preview");
    expect(thrown.rows.filter((r) => r.sheet === "Breakdown").every((r) => r.issues[0]?.message === NO_STOCK_LIST)).toBe(true);
  });
  it("bad dates, quantities and sections are reported against sheet, row and field", async () => {
    const p = await planOf(await workbook({
      deliverables: [["", "Hall", "", "", "", ""], ["", "Hall", "Stage screen", "", "", "next week"]],
      breakdown: [["", "D001", "", "", "Lighting", "Wash lights", "", "", "", "", ""], ["", "D001", "", "", "Hardware", "Truss", "-2", "", "", "31/12/2027", ""], ["", "D001", "", "", "Content", "Loop", "", "Media server", "", "", ""], ["", "", "Nowhere", "Nothing", "Testing", "Check", "", "", "", "", ""]],
    }), existingPlan());
    expect(p.rows.map((r) => `${r.sheet}, row ${r.row}: ${r.issues.map((i) => i.field).join(", ")}`)).toEqual([
      "Deliverables, row 2: Deliverable", "Deliverables, row 3: Needed by", "Breakdown, row 2: Section", "Breakdown, row 3: Quantity, Needed by", "Breakdown, row 4: Stock item", "Breakdown, row 5: Deliverable",
    ]);
    expect(p.payload).toEqual({ items: [], lines: [] });
  });
});

describe("8. the file itself", () => {
  it("formula cells and cells starting with = + - @ are read as text, never run", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(DELIVERABLES_SHEET);
    ws.addRow([...DELIVERABLE_HEADERS]);
    ws.addRow(["", "Lobby", { formula: 'HYPERLINK("http://bad.example","click")', result: "Kiosk from a formula" }, "=1+1", "", ""]);
    ws.addRow(["", "Lobby", "+Plus sign", "-minus", "@at", ""]);
    ws.addRow(["", "Lobby", { formula: "1/0" }, "", "", ""]);
    const p = await planOf(new Uint8Array(await wb.xlsx.writeBuffer()), emptyPlan());
    expect(p.payload.items[0]).toEqual({ ref: "Deliverables!2", id: null, fields: { zone: "Lobby", title: "Kiosk from a formula", specs: "=1+1" } });
    expect(p.rows[1]!.changes).toEqual([{ field: "Zone", from: "", to: "Lobby" }, { field: "Deliverable", from: "", to: "+Plus sign" }, { field: "Specifications", from: "", to: "-minus" }]);
    expect(p.rows[1]!.choices[0]).toMatchObject({ typed: "@at", reason: "unknown" });
    expect(p.rows[2]).toMatchObject({ status: "attention", issues: [{ field: "Deliverable" }] });  // a formula with no stored result is an empty cell
  });
  it("neutralises such cells on export, and reads them back unchanged", async () => {
    const plan = emptyPlan({ items: [item("D001", "=Zone", "+SUM(A1:A9)", { specs: "@cmd", owner_id: "gone", owner_name: "-Former Colleague", lines: [line("L0001", "content", "=HYPERLINK(1)", { notes: "-note" })] })] });
    const bytes = await buildDeliveryPlanExport(plan, PEOPLE);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect((wb.getWorksheet("Deliverables")!.getRow(2).values as unknown[]).slice(2, 6)).toEqual(["'=Zone", "'+SUM(A1:A9)", "'@cmd", "'-Former Colleague"]);
    expect([wb.getWorksheet("Breakdown")!.getCell("F2").value, wb.getWorksheet("Breakdown")!.getCell("K2").value]).toEqual(["'=HYPERLINK(1)", "'-note"]);
    wb.eachSheet((s) => s.eachRow((r) => r.eachCell((c) => expect(typeof c.value === "object" && c.value !== null && "formula" in c.value).toBe(false))));
    expect((await planOf(bytes, plan)).summary).toEqual({ add: 0, update: 0, unchanged: 2, attention: 0 });   // a former colleague's name is not looked up again
  });
  it("refuses .xlsm, other extensions, macros, an empty file and an oversized file", async () => {
    const good = await workbook({ deliverables: [["", "", "A screen", "", "", ""]] });
    expect(await parseDeliveryPlanWorkbook(good, "plan.xlsm")).toEqual({ ok: false, error: "Only .xlsx files are accepted." });
    expect(await parseDeliveryPlanWorkbook(good, "plan.csv")).toMatchObject({ ok: false });
    expect(await parseDeliveryPlanWorkbook(new Uint8Array(0), "plan.xlsx")).toMatchObject({ ok: false, error: "The file is empty." });
    expect(await parseDeliveryPlanWorkbook(new Uint8Array(4 * 1024 * 1024 + 1), "plan.xlsx")).toMatchObject({ ok: false, error: expect.stringMatching(/larger than 4 MB/) });
    expect(await parseDeliveryPlanWorkbook(new TextEncoder().encode("not a workbook at all, just text"), "plan.xlsx")).toMatchObject({ ok: false });
    const db = simulatedDb();
    expect(await runDeliveryPlanImport(db.deps(), req(good, { fileName: "plan.xlsm" }))).toMatchObject({ ok: false, status: 400, error: "Only .xlsx files are accepted." });
  });
  it("refuses more rows than the limits, and a workbook without the sheets", async () => {
    const many = await workbook({ deliverables: Array.from({ length: 1001 }, (_, n) => ["", "Zone", `Deliverable ${n}`, "", "", ""]) });
    expect(await parseDeliveryPlanWorkbook(many, "plan.xlsx")).toEqual({ ok: false, error: "The Deliverables sheet has more than 1000 deliverable rows. Split the workbook into smaller files." });
    const lines = await workbook({ breakdown: Array.from({ length: 2001 }, (_, n) => ["", "D001", "", "", "Testing", `Check ${n}`, "", "", "", "", ""]) });
    expect(await parseDeliveryPlanWorkbook(lines, "plan.xlsx")).toMatchObject({ ok: false, error: expect.stringMatching(/more than 2000 breakdown rows/) });
    const wb = new ExcelJS.Workbook(); wb.addWorksheet("Sheet1").addRow(["hello"]);
    expect(await parseDeliveryPlanWorkbook(new Uint8Array(await wb.xlsx.writeBuffer()), "plan.xlsx")).toMatchObject({ ok: false, error: expect.stringMatching(/no Deliverables sheet/) });
    expect(await parseDeliveryPlanWorkbook(await workbook({ deliverables: [["x"]], deliverableHeaders: ["Something else"] }), "plan.xlsx")).toMatchObject({ ok: false, error: expect.stringMatching(/no header row/) });
  });
  it("ignores the progress, released and reference image columns even when they are edited", async () => {
    const bytes = await editExport(releasedPlan(), (wb) => {
      const d = wb.getWorksheet("Deliverables")!; d.getCell("G2").value = "http://bad.example/image.png"; d.getCell("H2").value = "No"; d.getCell("I2").value = "All done";
      const b = wb.getWorksheet("Breakdown")!; b.getCell("L2").value = "No"; b.getCell("M2").value = "Returned 24 of 24 sent"; b.getCell("M3").value = "Task done";
    });
    const p = await planOf(bytes, releasedPlan());
    expect(p.summary).toEqual({ add: 0, update: 0, unchanged: 4, attention: 0 });
    expect(p.payload).toEqual({ items: [], lines: [] });
  });
  it("the template has the three sheets, its example rows are ignored, and it reads back as an empty workbook", async () => {
    const bytes = await buildDeliveryPlanTemplate();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Deliverables", "Breakdown", "Instructions"]);
    expect(String(wb.getWorksheet("Deliverables")!.getCell("B2").value)).toMatch(/^EXAMPLE/);
    expect((wb.getWorksheet("Breakdown")!.getRow(1).values as unknown[]).slice(1)).toEqual([...BREAKDOWN_HEADERS]);
    const text = wb.getWorksheet("Instructions")!.getColumn(1).values.join("\n");
    for (const must of [/one row per deliverable/i, /Breakdown sheet is optional/, /Leave the ID empty for a new row/, /never delete anything/, /never read from the workbook/, /proposals for the Project Manager/, /Equipment tab/, /Limits: \.xlsx only/]) expect(text).toMatch(must);
    expect(text).not.toMatch(/—/);
    expect(await parseDeliveryPlanWorkbook(bytes, "delivery-plan-template.xlsx")).toMatchObject({ ok: true, file: { items: [], lines: [], examplesSkipped: 4 } });
    const db = simulatedDb();
    expect(await runDeliveryPlanImport(db.deps(), req(bytes))).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/no rows to import/) });
  });
  it("a cell too long to read whole is left as it is and said so, never cut short", async () => {
    const long = "x".repeat(2500);
    const plan = existingPlan(); plan.items[0]!.specs = long;
    const p = await planOf(await editExport(plan, () => undefined), plan);
    expect(p.summary).toEqual({ add: 0, update: 0, unchanged: 4, attention: 0 });
    expect(p.warnings).toEqual([expect.stringMatching(/^Deliverables, row 2, Specifications: a cell of 2000 characters or more/)]);
  });
});

describe("9. who may import", () => {
  const delegate = () => existingPlan({ can_manage: false, my_sections: ["content"] });
  it("a delegate of one section imports that section only; another section and the Deliverables sheet are for the Project Manager", async () => {
    const bytes = await editExport(delegate(), (wb) => {
      wb.getWorksheet("Deliverables")!.getCell("D2").value = "4 m x 2 m";                     // a deliverable: not theirs
      wb.getWorksheet("Deliverables")!.addRow(["", "Lobby", "New kiosk", "", "", ""]);         // a new deliverable: not theirs
      const b = wb.getWorksheet("Breakdown")!;
      b.getCell("G2").value = 30;                                                             // hardware: not theirs
      b.getCell("F3").value = "Welcome film";                                                 // content: theirs
      b.getRow(4).values = ["", "D002", "", "", "Content", "Table graphics", "", "", "Ben Sample", "", ""]; // content: theirs
      b.getRow(5).values = ["", "D002", "", "", "Testing", "Run-through", "", "", "", "", ""];           // testing: not theirs
      b.getRow(6).values = ["", "", "Lobby", "New kiosk", "Content", "Kiosk screens", "", "", "", "", ""]; // theirs, but under a deliverable they cannot add
    });
    const p = await planOf(bytes, delegate());
    expect(p.rows.map((r) => [r.sheet, r.row, r.status, r.issues[0]?.message ?? ""])).toEqual([
      ["Deliverables", 2, "attention", ONLY_PM], ["Deliverables", 3, "unchanged", ""], ["Deliverables", 4, "attention", ONLY_PM],
      ["Breakdown", 2, "attention", ONLY_PM], ["Breakdown", 3, "update", ""], ["Breakdown", 4, "add", ""], ["Breakdown", 5, "attention", ONLY_PM],
      ["Breakdown", 6, "attention", "Its deliverable (Deliverables, row 4) needs attention first."],
    ]);
    expect(p.payload).toEqual({ items: [], lines: [
      { item_ref: null, item_id: "id-D001", id: "id-L0002", fields: { description: "Welcome film" } },
      { item_ref: null, item_id: "id-D002", id: null, fields: { section: "content", description: "Table graphics", assignee_id: "u-ben" } },
    ] });
  });
  it("a delegate's own lines import from a workbook with only their rows", async () => {
    const db = simulatedDb(delegate());
    const bytes = await workbook({ breakdown: [["L0002", "", "", "", "", "", "", "", "", "2027-02-27", ""], ["", "D002", "", "", "Content", "Table graphics", "", "", "", "", ""]] });
    const done = await ok(runDeliveryPlanImport(db.deps(), req(bytes, { mode: "confirm", rev: 7 })), "confirm");
    expect(done.counts).toMatchObject({ added: 1, updated: 1 });
    expect(db.calls[0]!.p_items).toEqual([]);
  });
  it("refuses the signed-out, a project the person cannot see, a summary-only viewer, a finished project and a person with no rights, before reading the file", async () => {
    const db = simulatedDb(existingPlan({ can_manage: false, my_sections: [] }));
    const bytes = await exhibition();
    const run = (over: Partial<DpImportDeps>, mode: "preview" | "confirm" = "preview") => runDeliveryPlanImport(db.deps(over), req(bytes, { mode, rev: 7 }));
    expect(await run({ signedIn: false })).toMatchObject({ ok: false, status: 401 });
    expect(await run({ project: null })).toMatchObject({ ok: false, status: 404 });
    expect(await run({ project: { id: PROJECT, companyId: COMPANY, status: "active", level: "summary" } })).toMatchObject({ ok: false, status: 403 });
    expect(await run({ project: { id: PROJECT, companyId: COMPANY, status: "completed", level: "details" } })).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/read-only/) });
    expect(await run({ project: { id: PROJECT, companyId: COMPANY, status: "archived", level: "details" } }, "confirm")).toMatchObject({ ok: false, status: 403 });
    expect(await run({})).toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/Only the Project Manager, or a person a section was delegated to/) });
    expect(await run({}, "confirm")).toMatchObject({ ok: false, status: 403 });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("says it could not load when the plan or the members cannot be read, and never treats that as an empty plan", async () => {
    const db = simulatedDb();
    const bytes = await exhibition();
    expect(await runDeliveryPlanImport(db.deps({ loadPlan: async () => ({ state: "error" }) }), req(bytes))).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/Could not load the Delivery plan/) });
    expect(await runDeliveryPlanImport(db.deps({ loadPlan: async () => ({ state: "not_installed" }) }), req(bytes))).toMatchObject({ ok: false, status: 503 });
    expect(await runDeliveryPlanImport(db.deps({ loadPlan: async () => ({ state: "denied" }) }), req(bytes))).toMatchObject({ ok: false, status: 403 });
    expect(await runDeliveryPlanImport(db.deps({ loadPeople: async () => { throw new Error("down"); } }), req(bytes, { mode: "confirm", rev: 0 }))).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/Could not load the project's members/) });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("a stale rev returns 409 preview_stale: caught before the database, and again when the database says so", async () => {
    const db = simulatedDb(existingPlan());
    const bytes = await exhibition();
    const preview = await ok(runDeliveryPlanImport(db.deps(), req(bytes)), "preview");
    db.state.plan.rev += 1;                                                    // someone changed the plan after the preview
    expect(await runDeliveryPlanImport(db.deps(), req(bytes, { mode: "confirm", rev: preview.rev }))).toEqual({ ok: false, status: 409, code: "preview_stale", error: PREVIEW_STALE });
    expect(db.rpc).not.toHaveBeenCalled();
    // The plan moves between this layer's read and the database's lock: the database refuses, and the answer is the same sentence.
    const racing = db.deps({ loadPlan: async () => ({ state: "ok", plan: { ...structuredClone(db.state.plan), rev: preview.rev } }) });
    expect(await runDeliveryPlanImport(racing, req(bytes, { mode: "confirm", rev: preview.rev }))).toEqual({ ok: false, status: 409, code: "preview_stale", error: PREVIEW_STALE });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(PREVIEW_STALE).toBe("The plan changed after this preview was prepared. Nothing was imported. Upload the workbook again.");
    expect(await runDeliveryPlanImport(db.deps(), req(bytes, { mode: "confirm" }))).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/Preview the workbook first/) });
  });
  it("any other database refusal means nothing was imported, with the database's own sentence", async () => {
    const db = simulatedDb();
    const refuse = (message: string, code?: string) => db.deps({ db: { rpc: vi.fn(async () => ({ data: null, error: { message, code } })) } as never });
    const bytes = await exhibition();
    expect(await runDeliveryPlanImport(refuse("The accountable owner must be an active member of the project", "22023"), req(bytes, { mode: "confirm", rev: 0 })))
      .toEqual({ ok: false, status: 400, error: "Nothing was imported. The accountable owner must be an active member of the project" });
    expect(await runDeliveryPlanImport(refuse("Only the Project Manager, a temporary project leader or a founder can change a deliverable", "42501"), req(bytes, { mode: "confirm", rev: 0 })))
      .toMatchObject({ ok: false, status: 403, error: expect.stringMatching(/^Nothing was imported\. Only the Project Manager/) });
  });
});
