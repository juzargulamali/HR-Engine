// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotationSnapshot } from "@enginious-hr/domain";
import { PROPOSAL, bundleFixture } from "./test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("storage must go through the seam in tests"); } }));
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ({ userId: "u", grants: [{ companyId: "22222222-2222-4222-8222-222222222222", capabilities: [] }], companies: [] }) }));
let bundle: unknown;
vi.mock("../data", () => ({ loadQuotation: async () => bundle }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import { exportSeams, quotationExport } from "./handler";
import { modelFromSnapshot } from "./doc-model";

/**
 * REGRESSION: a quotation frozen BEFORE the estimates-only change must keep exporting exactly as it was issued.
 * `__fixtures__/legacy-frozen-v1.json` is a fictional snapshot (no format marker) plus the PDF text, page count, sheet cells and file names that the code
 * produced for it BEFORE this change. The snapshot is never modified by the test (it is compared with itself after the exports).
 */
interface Fixture {
  snapshot: QuotationSnapshot;
  assets: Record<string, string>;
  golden: { pdfText: string; pdfPages: number; contentDisposition: { pdf: string; xlsx: string }; xlsx: { sheetName: string; cells: unknown[][]; imageCount: number; pageSetup: Record<string, unknown> } };
}
const fx = JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", "legacy-frozen-v1.json"), "utf8")) as Fixture;
const hasPdftotext = spawnSync("pdftotext", ["-v"]).error === undefined;

const text = (b: Buffer) => { const d = mkdtempSync(path.join(os.tmpdir(), "leg-")); writeFileSync(path.join(d, "q.pdf"), b); return spawnSync("pdftotext", ["-layout", path.join(d, "q.pdf"), "-"], { encoding: "utf8" }).stdout; };

beforeEach(() => {
  const stored = new Map(Object.entries(fx.assets).map(([p, b64]) => [`quotation-assets/${p}`, Buffer.from(b64, "base64") as Uint8Array]));
  exportSeams.storage = async (bk, p) => stored.get(`${bk}/${p}`) ?? null;
  // The live profile now has a website, a new address and contact details: none of it may reach a document that was issued before issuer branding existed.
  const b = bundleFixture({ snapshot: structuredClone(fx.snapshot), liveIssuerName: "LIVE Name", liveTrn: "1" }) as unknown as { issuer: Record<string, string | null> };
  Object.assign(b.issuer, { address: "LIVE address", website: "www.live.example", phone: "+1", email: "live@live.example" });
  bundle = b;
});

describe("a quotation issued before the estimates-only change", () => {
  it("is recognised as legacy (no format marker) and keeps its stored numbers, terms and Quotation wording in the model", () => {
    expect(fx.snapshot.terms.label).toBe("Standard terms (working draft, pending legal review)");
    const m = modelFromSnapshot(fx.snapshot);
    expect(m.format).toBe("legacy");
    expect(m.notice).toBeNull();
    expect(m.sections.map((s) => [s.number, s.title])).toEqual([["1", "Fabrication"], ["2", "AV"]]);
    expect(m.terms.clauses.map((c) => c.title)).toEqual(["Changes", "Confidentiality"]);
  });
  it.skipIf(!hasPdftotext)("the PDF has exactly the text, page count and file name it had when issued", async () => {
    const r = await quotationExport(PROPOSAL, "pdf");
    expect(r.headers.get("content-disposition")).toBe(fx.golden.contentDisposition.pdf);
    const b = Buffer.from(await r.arrayBuffer());
    expect(text(b)).toBe(fx.golden.pdfText);
    expect((b.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBe(fx.golden.pdfPages);
    for (const needle of ["Quotation", "Valid until: 2026-12-31", "Terms and conditions", "Standard terms (working draft, pending legal review)", "Payment milestones", "On acceptance"]) expect(text(b)).toContain(needle);
    expect(text(b)).not.toMatch(/budgetary estimate|Estimate|Review pricing|Sales enquiries|live\.example/i);
    expect(text(b)).not.toContain("LIVE");
    expect(b.toString("latin1")).not.toMatch(/\/URI|\/Subtype \/Link/);
  });
  it("the Excel file has exactly the cells, row heights, sheet name, picture count and file name it had when issued", async () => {
    const r = await quotationExport(PROPOSAL, "xlsx");
    expect(r.headers.get("content-disposition")).toBe(fx.golden.contentDisposition.xlsx);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as never);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe(fx.golden.xlsx.sheetName);
    const cells: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => { const vals: unknown[] = []; row.eachCell({ includeEmpty: false }, (c, col) => vals.push([col, typeof c.value === "object" && c.value && "richText" in (c.value as object) ? (c.value as { richText: { text: string }[] }).richText.map((t) => t.text).join("") : c.value])); cells.push([n, row.height ?? null, vals]); });
    expect(cells).toEqual(fx.golden.xlsx.cells);
    expect(ws.getImages().length).toBe(fx.golden.xlsx.imageCount);
    expect(ws.views[0]).toMatchObject({ state: "frozen" });
    // the print footer is the pre-change one (reference and page number only), and no hyperlink or sales row exists
    expect(ws.headerFooter.oddFooter).toBe(`&L${fx.snapshot.reference} rev ${fx.snapshot.revision}&RPage &P of &N`);
    ws.eachRow((row) => row.eachCell((c) => { expect(typeof c.value === "object" && c.value && "hyperlink" in c.value).toBe(false); expect(String(c.value)).not.toMatch(/Sales enquiries|LIVE/); }));
  });
  it("exporting never alters the frozen snapshot", async () => {
    const before = JSON.stringify(fx.snapshot);
    const b = bundle as { snapshot: { content: QuotationSnapshot } };
    await quotationExport(PROPOSAL, "pdf"); await quotationExport(PROPOSAL, "xlsx");
    expect(JSON.stringify(b.snapshot.content)).toBe(before);
  });
});
