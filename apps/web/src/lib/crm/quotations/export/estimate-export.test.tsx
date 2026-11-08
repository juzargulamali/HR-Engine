// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUDGETARY_NOTICE, ESTIMATE_FORMAT_MARKER } from "@enginious-hr/domain";
import { INTERNAL_MARKER, LONG_NOTE, PROPOSAL, bundleFixture, png, sha256, snapshotFixture } from "./test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("storage must go through the seam in tests"); } }));
let ctx: unknown;
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));
let bundle: unknown;
vi.mock("../data", () => ({ loadQuotation: async () => bundle }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { reference: "ENQ-FIX-2026-0007", title: "Fictional draft enquiry" }, error: null }) }) }) }) }) }));

import { exportBaseName, modelFromDraft, modelFromSnapshot } from "./doc-model";
import { exportSeams, quotationExport } from "./handler";
import { ESTIMATE_XLSX_PHOTO } from "./xlsx";
import { ESTIMATE_PHOTO } from "@/lib/pdf/quotation-document";

const hasPdftotext = spawnSync("pdftotext", ["-v"]).error === undefined;
const granted = { userId: "u", grants: [{ companyId: "22222222-2222-4222-8222-222222222222", capabilities: [] }], companies: [] };
const run = (kind: "pdf" | "xlsx") => quotationExport(PROPOSAL, kind);
const buf = async (r: Response) => Buffer.from(await r.arrayBuffer());
const tmp = (b: Buffer, ext: string) => { const d = mkdtempSync(path.join(os.tmpdir(), "est-")); const f = path.join(d, `q.${ext}`); writeFileSync(f, b); return f; };
const pdfPages = (b: Buffer): string[] => spawnSync("pdftotext", ["-layout", tmp(b, "pdf"), "-"], { encoding: "utf8" }).stdout.split("\f").filter((p) => p.trim());
const flat = (t: string) => t.replace(/\s+/g, " ").trim();
async function sheet(b: Buffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(b as never); return wb.worksheets[0]!; }
const cellText = (ws: ExcelJS.Worksheet) => { const out: string[] = []; ws.eachRow((row) => row.eachCell((c) => c.type !== ExcelJS.ValueType.Merge && out.push(typeof c.value === "object" && c.value && "richText" in c.value ? c.value.richText.map((t) => t.text).join("") : String(c.value ?? "")))); return out; };
const rowOf = (ws: ExcelJS.Worksheet, re: RegExp) => { let n = -1; ws.eachRow((row, i) => { if (n < 0 && (row.values as unknown[]).some((v) => (typeof v === "string" && re.test(v)) || (typeof v === "object" && v !== null && "richText" in v && re.test((v as { richText: { text: string }[] }).richText.map((t) => t.text).join(""))))) n = i; }); return n; };
let stored: Map<string, Uint8Array>;
beforeEach(() => { ctx = granted; stored = new Map(); exportSeams.storage = async (bk, p) => stored.get(`${bk}/${p}`) ?? null; bundle = bundleFixture({ snapshot: snapshotFixture() }); });

describe("the mandatory budgetary notice", () => {
  it.each([["a one-item estimate", { noMilestones: true, exclusions: false, assumptions: "", nextSteps: "" }], ["a 60-item estimate with long notes", { lines60: true, longDescription: true, assumptions: LONG_NOTE("Assumptions"), nextSteps: LONG_NOTE("Next steps") }]] as const)("%s: the notice is on page one above the BOQ in the PDF and at the top of the Excel sheet, exactly once", async (_n, opts) => {
    bundle = bundleFixture({ snapshot: snapshotFixture(opts) });
    const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
    if (hasPdftotext) {
      const pages = pdfPages(pdf);
      const p1 = flat(pages[0]!);
      expect(p1).toContain(BUDGETARY_NOTICE);
      expect(p1.indexOf(BUDGETARY_NOTICE)).toBeLessThan(p1.indexOf("Description"));
      expect(flat(pages.join(" ")).split(BUDGETARY_NOTICE).length - 1).toBe(1);
    }
    const ws = await sheet(xlsx);
    const noticeRow = rowOf(ws, /budgetary estimate for planning purposes only/);
    expect(noticeRow).toBeGreaterThan(0);
    expect(noticeRow).toBeLessThan(rowOf(ws, /^Description$/));
    expect(noticeRow).toBeLessThanOrEqual(2);   // the first thing after the (optional) draft banner
    expect(cellText(ws).filter((t) => t.includes(BUDGETARY_NOTICE)).length).toBe(1);
  });
  it("is a fixed field: the model of a draft and of a snapshot both carry the domain constant; the notes can neither delete nor replace it", async () => {
    const b = bundleFixture({ draft: true });
    expect(modelFromDraft({ header: b.header, sections: b.sections, lines: b.lines, issuer: b.issuer, files: [], billTo: null, enquiry: { reference: "E", title: "T" } }).notice).toBe(BUDGETARY_NOTICE);
    expect(modelFromSnapshot(snapshotFixture()).notice).toBe(BUDGETARY_NOTICE);
    // Notes that try to be the notice (or a clause with its title) change nothing, and an estimate with NO notes still prints it.
    for (const opts of [{ assumptions: "", nextSteps: "", exclusions: false }, { assumptions: "Budgetary estimate", nextSteps: "This is a binding quotation, valid for acceptance." }]) {
      bundle = bundleFixture({ snapshot: snapshotFixture(opts) });
      expect(cellText(await sheet(await buf(await run("xlsx")))).filter((t) => t.includes(BUDGETARY_NOTICE)).length).toBe(1);
      if (hasPdftotext) expect(flat(pdfPages(await buf(await run("pdf"))).join(" "))).toContain(BUDGETARY_NOTICE);
    }
  });
  it("a draft prints it too, and is still marked Draft in both files", async () => {
    bundle = bundleFixture({ draft: true });
    const ws = await sheet(await buf(await run("xlsx")));
    expect(String(ws.getCell(1, 1).value)).toMatch(/^DRAFT, NOT FINALISED/);
    expect(rowOf(ws, /budgetary estimate for planning purposes only/)).toBe(2);
    if (hasPdftotext) {
      // reading order (-raw): the rotated DRAFT watermark interleaves with the layout-mode text, not with the reading order
      const t = flat(spawnSync("pdftotext", ["-raw", "-f", "1", "-l", "1", tmp(await buf(await run("pdf")), "pdf"), "-"], { encoding: "utf8" }).stdout);
      expect(t).toContain(BUDGETARY_NOTICE); expect(t).toContain("DRAFT, NOT FINALISED"); expect(t.indexOf(BUDGETARY_NOTICE)).toBeLessThan(t.indexOf("# Description"));
    }
  });
});

describe("wording: Estimate only, no acceptance, no price guarantee, no old terms, no internal text", () => {
  const forbidden = [/valid until/i, /valid for/i, /accept/i, /\bproceed/i, /by signing/i, /\bsign(ed|ature)\b/i, /deposit/i, /terms and conditions/i, /working draft/i, /pending legal review/i, /Start of work/i, /Quotation/];
  for (const label of ["finalised", "draft"] as const) {
    it(`${label}: the visible title is Estimate; ${forbidden.length} forbidden phrases are absent from the PDF text and the Excel cells; "quotation" only inside the notice`, async () => {
      bundle = label === "draft" ? bundleFixture({ draft: true }) : bundleFixture({ snapshot: snapshotFixture({ assumptions: LONG_NOTE("Assumptions", 2) }) });
      if (label === "draft") {
        // a historical draft still carries the six copied standard clauses and a legacy label: none of it may reach a client file
        const h = (bundle as { header: { terms: unknown; terms_label: string } }).header;
        h.terms_label = "Standard terms (working draft, pending legal review)";
        h.terms = [{ title: "Start of work", body: "Work begins after written acceptance of the quotation and receipt of the initial payment." }, { title: "Next steps", body: "Review the budget together." }];
      }
      const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
      const cells = cellText(await sheet(xlsx)).join("\n");
      const texts = [cells, ...(hasPdftotext ? [pdfPages(pdf).join("\n")] : [])];
      for (const t of texts) {
        const withoutNotice = t.replace(/\s+/g, " ").replace(BUDGETARY_NOTICE, "");
        for (const re of forbidden) expect(withoutNotice, String(re)).not.toMatch(re);
        expect(t).toMatch(/Estimate/);
        expect(t).not.toContain(INTERNAL_MARKER);
      }
      expect(pdf.toString("latin1")).not.toContain(INTERNAL_MARKER);
      expect(xlsx.toString("latin1")).not.toContain(INTERNAL_MARKER);
      expect(cells).toContain("Review pricing after: 2026-12-31");
      if (hasPdftotext && label === "finalised") expect(flat(pdfPages(pdf).join(" "))).toContain("Pricing to be reviewed after 2026-12-31. This is not a price guarantee.");
      if (label === "finalised") expect(cells).toContain("Pricing to be reviewed after 2026-12-31. This is not a price guarantee.");
    });
  }
  it("the file name carries the estimate reference (EST- for new, QUO- unchanged) and the revision", () => {
    expect(exportBaseName({ reference: "EST-UAE-2026-0001", revision: 2, draft: false })).toBe("EST-UAE-2026-0001-rev2");
    expect(exportBaseName({ reference: "QUO-UAE-2026-0001", revision: 1, draft: true })).toBe("QUO-UAE-2026-0001-rev1-DRAFT");
    expect(exportBaseName({ reference: "", revision: 1, draft: false })).toBe("estimate-rev1");
  });
});

describe("optional client notes", () => {
  it("empty blocks are omitted entirely (no heading) in both files", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ assumptions: "", nextSteps: "", exclusions: false, noMilestones: true }) });
    const cells = cellText(await sheet(await buf(await run("xlsx"))));
    for (const h of ["Assumptions", "Exclusions", "Next steps", "Indicative payment schedule"]) expect(cells, h).not.toContain(h);
    if (hasPdftotext) { const t = pdfPages(await buf(await run("pdf"))).join("\n"); for (const h of ["Assumptions", "Exclusions", "Next steps", "Indicative payment schedule"]) expect(t, h).not.toMatch(new RegExp(`^\\s*${h}\\s*$`, "m")); }
  });
  it("Assumptions, Exclusions and Next steps print under their headings, in that order, with every paragraph", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ assumptions: LONG_NOTE("Assumptions", 3), nextSteps: LONG_NOTE("Next steps", 3) }) });
    const cells = cellText(await sheet(await buf(await run("xlsx"))));
    const at = (h: string) => cells.indexOf(h);
    expect(at("Assumptions")).toBeGreaterThan(-1);
    expect(at("Exclusions")).toBeGreaterThan(at("Assumptions"));
    expect(at("Next steps")).toBeGreaterThan(at("Exclusions"));
    for (const n of [1, 2, 3]) expect(cells.some((c) => c.startsWith(`Assumptions paragraph ${n}.`))).toBe(true);
    if (hasPdftotext) {
      const t = flat(pdfPages(await buf(await run("pdf"))).join(" "));
      for (const n of [1, 2, 3]) { expect(t).toContain(`Assumptions paragraph ${n}.`); expect(t).toContain(`Next steps paragraph ${n}.`); }
      expect(t.indexOf("Exclusions")).toBeGreaterThan(t.indexOf("Assumptions paragraph 3."));
    }
  });
  it.skipIf(!hasPdftotext)("a heading is never the last thing on a page (long notes after a 60-line BOQ)", async () => {
    for (const lines60 of [true, false]) {
      bundle = bundleFixture({ snapshot: snapshotFixture({ lines60, longDescription: true, assumptions: LONG_NOTE("Assumptions", 6), nextSteps: LONG_NOTE("Next steps", 6) }) });
      const pages = pdfPages(await buf(await run("pdf")));
      for (const p of pages) {
        const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
        const body = lines.filter((l) => !/^Page \d+ of \d+$/.test(l) && !/·.*Revision/.test(l));
        expect(["Assumptions", "Exclusions", "Next steps"], `last body line "${body.at(-1)}"`).not.toContain(body.at(-1));
      }
      expect(pages.length).toBeGreaterThan(lines60 ? 2 : 1);
    }
  });
});

describe("totals", () => {
  it.skipIf(!hasPdftotext)("the three total lines are kept together on one page, after the last item, and the Excel totals sit near the end of the table", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ lines60: true, assumptions: LONG_NOTE("Assumptions", 3) }) });
    const pages = pdfPages(await buf(await run("pdf")));
    const holder = pages.filter((p) => /Total excl\. VAT/.test(p));
    expect(holder).toHaveLength(1);
    expect(holder[0]).toMatch(/VAT\s+EUR\s/);
    expect(holder[0]).toMatch(/Total incl\. VAT\s+EUR\s/);
    expect(pages.indexOf(holder[0]!)).toBeGreaterThanOrEqual(pages.findIndex((p) => /\b1\.60\s+Item 60\b/.test(p)));
    const ws = await sheet(await buf(await run("xlsx")));
    const lastItem = rowOf(ws, /^1\.60$/); const tot = rowOf(ws, /^Total excl\. VAT$/);
    expect(tot - lastItem).toBeLessThanOrEqual(4);
    expect(ws.getRow(rowOf(ws, /^Total incl\. VAT$/)).getCell(6).font?.bold).toBe(true);
  });
  it("the PDF and the Excel file agree on the totals and the key strings (same document model)", async () => {
    const snap = snapshotFixture({ agency: true });
    bundle = bundleFixture({ snapshot: snap });
    const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
    const cells = cellText(await sheet(xlsx)).join("\n");
    const t = hasPdftotext ? flat(pdfPages(pdf).join(" ")) : null;
    const grouped = (v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const keys = [snap.reference, snap.bill_to.name, snap.enquiry.title, snap.issuer.legal_name, "Prepared for".toUpperCase(), "Indicative payment schedule", "Review pricing after: 2026-12-31", BUDGETARY_NOTICE, "Finalised on: 2026-11-02"];
    for (const k of keys) { if (k === "Prepared for".toUpperCase()) { expect(cells).toContain("PREPARED FOR"); } else { expect(cells).toContain(k); if (t) expect(t).toContain(k); } }
    const ws = await sheet(xlsx);
    const totalRows = ["Total excl. VAT", "VAT", "Total incl. VAT"].map((l) => Number(ws.getRow(rowOf(ws, new RegExp(`^${l.replace(/\./g, "\\.")}$`))).getCell(10).value));
    expect(totalRows).toEqual([Number(snap.totals.net), Number(snap.totals.vat), Number(snap.totals.gross)]);
    if (t) for (const v of [snap.totals.net, snap.totals.vat, snap.totals.gross]) expect(t).toContain(grouped(v));
  });
});

describe("numbering of items outside any section", () => {
  it("loose items are 1, 2 and have no heading or subtotal; sections stay 1, 1.1 ... (PDF and Excel)", async () => {
    const snap = snapshotFixture({ loose: true });
    bundle = bundleFixture({ snapshot: snap });
    const m = modelFromSnapshot(snap);
    expect(m.sections.map((s) => s.number)).toEqual([null, "1", "2"]);
    expect(m.sections.map((s) => s.title)).toEqual([null, "Fabrication", "AV"]);
    expect(m.sections.flatMap((s) => s.lines.map((l) => l.number))).toEqual(["1", "2", "1.1", "1.2", "2.1"]);
    const ws = await sheet(await buf(await run("xlsx")));
    const cells = cellText(ws);
    expect(cells).toEqual(expect.arrayContaining(["1", "2", "1.1", "1.2", "2.1", "1 Fabrication", "2 AV"]));
    expect(cells.join("\n")).not.toMatch(/no section/i);
    expect(rowOf(ws, /^Subtotal: /)).toBeGreaterThan(0);
    expect(cells.filter((c) => /^Subtotal:/.test(c))).toEqual(["Subtotal: 1 Fabrication", "Subtotal: 2 AV"]);
    if (hasPdftotext) {
      const t = pdfPages(await buf(await run("pdf"))).join("\n");
      expect(t).toMatch(/^\s*1\s+Loose item one/m); expect(t).toMatch(/^\s*2\s+Loose item two/m);
      expect(t).toMatch(/1\.1\s+Stage deck/); expect(t).not.toMatch(/no section/i);
    }
  });
  it("an estimate with only loose items prints no section heading at all", async () => {
    const snap = snapshotFixture({ loose: true });
    snap.sections = snap.sections.slice(0, 1);
    snap.totals = { net: "175.50", vat: "8.78", gross: "184.28" };
    bundle = bundleFixture({ snapshot: snap });
    const cells = cellText(await sheet(await buf(await run("xlsx"))));
    expect(cells.filter((c) => /^\d+ [A-Z]/.test(c) && !/^\d+ (Loose|Estimate)/.test(c))).toEqual([]);
    expect(cells.some((c) => /^Subtotal/.test(c))).toBe(false);
  });
});

describe("photos: large enough to inspect, never stretched", () => {
  const photoSizes = { landscape: [640, 480], portrait: [480, 640] } as const;
  async function twoPhotoEstimate() {
    const a = await png("#cc3322", ...photoSizes.landscape); const b = await png("#2233cc", ...photoSizes.portrait);
    const snap = snapshotFixture({ withImages: [{ lineNumber: "1.1", sha: sha256(a) }, { lineNumber: "1.2", sha: sha256(b) }] });
    stored.set(`quotation-assets/${snap.sections[0]!.lines[0]!.image!.storage_path}`, a);
    stored.set(`quotation-assets/${snap.sections[0]!.lines[1]!.image!.storage_path}`, b);
    bundle = bundleFixture({ snapshot: snap });
  }
  it("Excel: the photo box is at least 40 x 30 mm, rows are tall enough, and each picture keeps its aspect ratio (4:3 and 3:4)", async () => {
    await twoPhotoEstimate();
    const ws = await sheet(await buf(await run("xlsx")));
    const imgs = ws.getImages();
    expect(imgs).toHaveLength(2);
    const exts = imgs.map((i) => (i.range as unknown as { ext: { width: number; height: number } }).ext);
    const ratios = exts.map((e) => e.width / e.height).sort();
    expect(ratios[0]).toBeCloseTo(0.75, 1); expect(ratios[1]).toBeCloseTo(4 / 3, 1);
    const mm = (px: number) => px * 25.4 / 96;
    expect(mm(ESTIMATE_XLSX_PHOTO.boxW)).toBeGreaterThanOrEqual(40);
    expect(mm(ESTIMATE_XLSX_PHOTO.boxH)).toBeGreaterThanOrEqual(30);
    for (const e of exts) { expect(e.width).toBeLessThanOrEqual(ESTIMATE_XLSX_PHOTO.boxW); expect(e.height).toBeLessThanOrEqual(ESTIMATE_XLSX_PHOTO.boxH); expect(Math.max(e.width * 1, e.height * 1)).toBeGreaterThanOrEqual(120); }
    for (const n of ["1.1", "1.2"]) expect(ws.getRow(rowOf(ws, new RegExp(`^${n.replace(".", "\\.")}$`))).height).toBeGreaterThanOrEqual(ESTIMATE_XLSX_PHOTO.rowPt);
  });
  it("the PDF photo area is at least 40 x 30 mm (points converted), and the embedded pictures keep their pixels and ratio", async () => {
    const pt = (v: number) => v * 25.4 / 72;
    expect(pt(ESTIMATE_PHOTO.width)).toBeGreaterThanOrEqual(40);
    expect(pt(ESTIMATE_PHOTO.height)).toBeGreaterThanOrEqual(30);
    expect(ESTIMATE_PHOTO.row).toBeGreaterThan(ESTIMATE_PHOTO.height);
    if (!hasPdftotext) return;
    await twoPhotoEstimate();
    const pdf = await buf(await run("pdf"));
    const list = spawnSync("pdfimages", ["-list", tmp(pdf, "pdf")], { encoding: "utf8" }).stdout.split("\n").slice(2).filter(Boolean).map((l) => l.trim().split(/\s+/)).filter((c) => c[2] === "image");
    const dims = list.map((c) => [Number(c[3]), Number(c[4])]).filter(([w, h]) => (w === 640 && h === 480) || (w === 480 && h === 640));   // the two pictures, not the bundled logo
    expect(dims).toHaveLength(2);
    expect(dims.map(([w, h]) => Math.round((w! / h!) * 100) / 100).sort()).toEqual([0.75, 1.33]);
  });
  it("PDF rendering: each photo is drawn in its own aspect ratio inside the box (measured on the rendered page, so stretching would show)", async () => {
    if (!hasPdftotext) return;
    await twoPhotoEstimate();
    const pdf = await buf(await run("pdf"));
    const dir = mkdtempSync(path.join(os.tmpdir(), "est-r-"));
    spawnSync("pdftoppm", ["-png", "-r", "144", "-f", "1", "-l", "1", tmp(pdf, "pdf"), path.join(dir, "p")]);
    const file = spawnSync("sh", ["-c", `ls ${dir}/p*.png`], { encoding: "utf8" }).stdout.trim().split("\n")[0]!;
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const box = (r: number, g: number, bl: number) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) { const i = (y * info.width + x) * info.channels; if (Math.abs(data[i]! - r) < 12 && Math.abs(data[i + 1]! - g) < 12 && Math.abs(data[i + 2]! - bl) < 12) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
      return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };
    const red = box(0xcc, 0x33, 0x22); const blue = box(0x22, 0x33, 0xcc);
    expect(red.w / red.h).toBeCloseTo(4 / 3, 1);
    expect(blue.w / blue.h).toBeCloseTo(3 / 4, 1);
    const mmPx = 144 / 25.4;
    expect(red.w / mmPx).toBeGreaterThanOrEqual(38); expect(red.h / mmPx).toBeGreaterThanOrEqual(28);   // landscape: ~41.7 x 31.0 mm
    expect(blue.h / mmPx).toBeGreaterThanOrEqual(28);   // portrait fills the height
  });
});
