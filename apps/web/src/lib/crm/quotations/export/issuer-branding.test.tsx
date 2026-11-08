// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotationSnapshot } from "@enginious-hr/domain";
import { ESTIMATE_FORMAT_MARKER } from "@enginious-hr/domain";
import { INTERNAL_MARKER, LONG_NOTE, PROPOSAL, bundleFixture, png, sha256, snapshotFixture } from "./test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("storage must go through the seam in tests"); } }));
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ({ userId: "u", grants: [{ companyId: "22222222-2222-4222-8222-222222222222", capabilities: [] }], companies: [] }) }));
let bundle: unknown;
vi.mock("../data", () => ({ loadQuotation: async () => bundle }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { reference: "ENQ-FIX-2026-0007", title: "Fictional draft enquiry" }, error: null }) }) }) }) }) }));

import { modelFromSnapshot } from "./doc-model";
import { exportSeams, quotationExport } from "./handler";

/**
 * Issuer branding: header block, sales enquiries footer, website link, freezing at finalisation, and the older documents staying exactly as they were. Fictional data only.
 */
const hasPdftotext = spawnSync("pdftotext", ["-v"]).error === undefined;
const run = (kind: "pdf" | "xlsx") => quotationExport(PROPOSAL, kind);
const buf = async (r: Response) => Buffer.from(await r.arrayBuffer());
const tmp = (b: Buffer, ext: string) => { const d = mkdtempSync(path.join(os.tmpdir(), "brand-")); const f = path.join(d, `q.${ext}`); writeFileSync(f, b); return f; };
const pdfPages = (b: Buffer): string[] => spawnSync("pdftotext", ["-layout", tmp(b, "pdf"), "-"], { encoding: "utf8" }).stdout.split("\f").filter((p) => p.trim());
const flat = (t: string) => t.replace(/\s+/g, " ").trim();
const uris = (b: Buffer) => [...b.toString("latin1").matchAll(/\/URI \(([^)]*)\)/g)].map((m) => m[1]!);
/** One link annotation per page (the footer is `fixed`): the expected list for a document of this many pages. */
const onEveryPage = (b: Buffer, target: string) => Array(pageCount(b)).fill(target) as string[];
const pageCount = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
async function sheet(b: Buffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(b as never); return wb.worksheets[0]!; }
const plain = (v: ExcelJS.CellValue): string => (typeof v === "object" && v !== null && "richText" in v ? v.richText.map((t) => t.text).join("") : typeof v === "object" && v !== null && "text" in v ? String((v as { text: string }).text) : String(v ?? ""));
const colText = (ws: ExcelJS.Worksheet, col: number) => { const out: string[] = []; ws.eachRow((row) => { const c = row.getCell(col); if (c.type !== ExcelJS.ValueType.Merge && c.value != null) out.push(plain(c.value)); }); return out; };
const cellText = (ws: ExcelJS.Worksheet) => { const out: string[] = []; ws.eachRow((row) => row.eachCell((c) => c.type !== ExcelJS.ValueType.Merge && out.push(plain(c.value)))); return out; };
const SALES = "Sales enquiries: +000 11 222 3333 · sales@fictional.example · www.fictional.example";
let reads: string[];
beforeEach(() => { reads = []; exportSeams.storage = async (bk, p) => { reads.push(`${bk}/${p}`); return null; }; bundle = bundleFixture({ snapshot: snapshotFixture() }); });

describe("header block (estimate-format:2 and drafts)", () => {
  it.skipIf(!hasPdftotext)("page one: legal name, the address lines as stored, then 'TRN: <value>', with the title block under the issuer block; no contact line in the header", async () => {
    const p1 = pdfPages(await buf(await run("pdf")))[0]!;
    const lines = p1.split("\n").map((l) => l.trim()).filter(Boolean);
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(at("Fictional Enginious UAE LLC")).toBe(0);
    expect(lines[1]).toBe("Fictional Tower, Level 4");
    expect(lines[2]).toBe("Fictional Bay, Dubai 00000");
    expect(lines[3]).toBe("TRN: 100200300400003");
    expect(at("Estimate")).toBeGreaterThan(3);
    expect(p1).not.toMatch(/TRN 1002/);
    // the contact details live in the footer only
    expect(lines.slice(0, 12).join("\n")).not.toContain("sales@fictional.example");
  });
  it("Excel: the same lines in the same order at the top of the sheet", async () => {
    const ws = await sheet(await buf(await run("xlsx")));
    const cells = colText(ws, 1);
    const i = cells.indexOf("Fictional Enginious UAE LLC");
    expect(cells.slice(i, i + 4)).toEqual(["Fictional Enginious UAE LLC", "Fictional Tower, Level 4", "Fictional Bay, Dubai 00000", "TRN: 100200300400003"]);
  });
  it("the TRN line is omitted entirely when absent (never blank), in both files", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ trn: null }) });
    expect(cellText(await sheet(await buf(await run("xlsx")))).join("\n")).not.toMatch(/TRN: ?(\n|$)|TRN: null/);
    expect(cellText(await sheet(await buf(await run("xlsx")))).some((c) => /^TRN: 1002/.test(c) || c === "TRN:")).toBe(false);
    if (hasPdftotext) expect(pdfPages(await buf(await run("pdf")))[0]!.split("\n").some((l) => l.trim().startsWith("TRN:") && !l.includes("VAT"))).toBe(false);
  });
  it("a profile with no logo prints no logo (the bundled ENGINIOUS logo is not substituted) when the BOQ has no photos", async () => {
    const pdf = await buf(await run("pdf"));
    expect(pdf.toString("latin1")).not.toContain("/Subtype /Image");
  });
  it("the pinned profile logo is embedded when present", async () => {
    const logo = await png("#118844", 120, 40);
    const sha = sha256(logo);
    const snap = snapshotFixture({ logoSha: sha });
    exportSeams.storage = async (bk, p) => (`${bk}/${p}` === `quotation-assets/${snap.issuer.logo!.storage_path}` ? logo : null);
    bundle = bundleFixture({ snapshot: snap });
    expect((await buf(await run("pdf"))).toString("latin1")).toContain("/Subtype /Image");
    expect((await sheet(await buf(await run("xlsx")))).getImages().length).toBe(1);
  });
});

describe("footer: the sales enquiries line on every page", () => {
  it.skipIf(!hasPdftotext)("every page of a multi-page estimate carries the line, the reference and 'Page x of y'; the website is a link on every page; nothing overlaps the BOQ", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ lines60: true, longDescription: true, assumptions: LONG_NOTE("Assumptions", 5), nextSteps: LONG_NOTE("Next steps", 5) }) });
    const pdf = await buf(await run("pdf"));
    const pages = pdfPages(pdf);
    expect(pages.length).toBeGreaterThan(2);
    pages.forEach((p, n) => {
      const last = p.split("\n").map((l) => l.trim()).filter(Boolean).at(-1)!;
      expect(flat(last)).toContain(SALES);
      expect(last).toContain("Estimate QUO-FIX-2026-0001");
      expect(last).toContain(`Page ${n + 1} of ${pages.length}`);
    });
    expect(uris(pdf)).toEqual(Array(pages.length).fill("https://www.fictional.example"));
    expect(pageCount(pdf)).toBe(pages.length);
  });
  it("the label is fixed text in code, the parts are exactly as stored, and a stored https URL links to itself", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ issuer: { website: "https://www.fictional.example" } }) });
    const pdf = await buf(await run("pdf"));
    expect(uris(pdf)).toEqual(onEveryPage(pdf, "https://www.fictional.example"));
    if (hasPdftotext) expect(flat(pdfPages(pdf)[0]!)).toContain("Sales enquiries: +000 11 222 3333 · sales@fictional.example · https://www.fictional.example");
  });
  it.each([
    ["no website", { website: null }, "Sales enquiries: +000 11 222 3333 · sales@fictional.example"],
    ["no phone", { phone: null }, "Sales enquiries: sales@fictional.example · www.fictional.example"],
    ["no email", { email: " " }, "Sales enquiries: +000 11 222 3333 · www.fictional.example"],
    ["only a website", { phone: null, email: null }, "Sales enquiries: www.fictional.example"],
  ] as const)("%s: the missing part and its separator are omitted", async (_n, issuer, expected) => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ issuer }) });
    const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
    if (hasPdftotext) { const t = flat(pdfPages(pdf)[0]!); expect(t).toContain(expected); expect(t).not.toMatch(/ · (Page|$)| · +·/); }
    const ws = await sheet(xlsx);
    expect(flat(cellText(ws).filter((c) => !c.startsWith("TRN")).join(" "))).toContain(expected);
    expect(ws.headerFooter.oddFooter).toContain(expected);
  });
  it("the whole line is omitted when phone, email and website are all missing (PDF footer keeps reference and page number; Excel has no sales row)", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ issuer: { phone: null, email: null, website: null } }) });
    const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
    expect(uris(pdf)).toEqual([]);
    if (hasPdftotext) { const t = pdfPages(pdf)[0]!; expect(t).not.toContain("Sales enquiries"); expect(t).toMatch(/Page 1 of \d/); expect(t).toContain("Estimate QUO-FIX-2026-0001"); }
    const ws = await sheet(xlsx);
    expect(cellText(ws).join("\n")).not.toContain("Sales enquiries");
    expect(ws.headerFooter.oddFooter).not.toContain("Sales enquiries");
    expect(ws.headerFooter.oddFooter).toContain("Page &P of &N");
  });
  it("an address is optional too: nothing blank is printed", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ issuer: { address: null } }) });
    expect(modelFromSnapshot((bundle as { snapshot: { content: QuotationSnapshot } }).snapshot.content).addressLines).toEqual([]);
    const cells = colText(await sheet(await buf(await run("xlsx"))), 1);
    const i = cells.indexOf("Fictional Enginious UAE LLC");
    expect(cells[i + 1]).toBe("TRN: 100200300400003");
  });
});

describe("the website link", () => {
  it.each([["www.fictional.example", "https://www.fictional.example"], ["https://www.fictional.example", "https://www.fictional.example"], ["http://www.fictional.example", "https://www.fictional.example"], ["  www.fictional.example/en  ", "https://www.fictional.example/en"]])("%j links to %s in the PDF annotation and in the Excel hyperlink cell", async (stored, target) => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ issuer: { website: stored } }) });
    const pdf = await buf(await run("pdf"));
    expect(uris(pdf)).toEqual(onEveryPage(pdf, target));
    const ws = await sheet(await buf(await run("xlsx")));
    let link: ExcelJS.CellHyperlinkValue | null = null;
    ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === "object" && c.value && "hyperlink" in c.value) link = c.value as ExcelJS.CellHyperlinkValue; }));
    expect(link!.hyperlink).toBe(target);
    expect(link!.text).toBe(stored.trim());
  });
  it.each(["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "vbscript:x", "ftp://files.fictional.example", "//www.fictional.example"])("%j is printed as plain text and never linked, in either file", async (stored) => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ issuer: { website: stored } }) });
    const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
    expect(uris(pdf)).toEqual([]);
    expect(pdf.toString("latin1")).not.toMatch(/\/URI|\/Subtype \/Link/);
    const ws = await sheet(xlsx);
    ws.eachRow((row) => row.eachCell((c) => expect(typeof c.value === "object" && c.value && "hyperlink" in c.value).toBe(false)));
    expect(ws.getImages().length).toBe(0);
    expect(cellText(ws).join("\n")).toContain(stored.trim());
    if (hasPdftotext) expect(flat(pdfPages(pdf)[0]!)).toContain(stored.trim());
  });
});

describe("Excel footer and PDF footer carry the same words", () => {
  it("the visible bottom row and the print footer say what the PDF footer says; the website cell is the last link", async () => {
    const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
    const ws = await sheet(xlsx);
    const cells = cellText(ws);
    const before = cells.find((c) => c.startsWith("Sales enquiries:"))!;
    expect(`${before} ${cells[cells.indexOf(before) + 1]}`).toBe(SALES);
    expect(cells.at(-1)).toBe("www.fictional.example");   // bottom row of the sheet
    expect(ws.headerFooter.oddFooter).toBe(`&L&8QUO-FIX-2026-0001 rev 1&C&8${SALES}&R&8Page &P of &N`.replace("&L&8QUO", "&L&8Estimate QUO"));
    if (hasPdftotext) expect(flat(pdfPages(pdf)[0]!)).toContain(SALES);
  });
  it("an '&' in a stored value is escaped in the print footer and an over-long line never exceeds 255 characters", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ issuer: { phone: "R&D +000 11", email: "a".repeat(80) + "@fictional.example", website: "www." + "b".repeat(80) + ".example" } }) });
    const f = (await sheet(await buf(await run("xlsx")))).headerFooter.oddFooter!;
    expect(f).toContain("R&&D +000 11");
    expect(f.length).toBeLessThanOrEqual(255);
    expect(f).toContain("Sales enquiries:");
  });
});

describe("a finalised revision is frozen; a new revision picks up the new profile", () => {
  const dump = async () => ({ xlsx: cellText(await sheet(await buf(await run("xlsx")))), pdf: hasPdftotext ? pdfPages(await buf(await run("pdf"))) : [], links: uris(await buf(await run("pdf"))), footer: (await sheet(await buf(await run("xlsx")))).headerFooter.oddFooter });
  it("editing the live company profile (address, TRN, website, logo) changes nothing in the re-export of the same revision", async () => {
    const logo = await png("#118844", 120, 40);
    const snap = snapshotFixture({ logoSha: sha256(logo) });
    exportSeams.storage = async (bk, p) => { reads.push(`${bk}/${p}`); return `${bk}/${p}` === `quotation-assets/${snap.issuer.logo!.storage_path}` ? logo : null; };
    bundle = bundleFixture({ snapshot: snap });
    const before = await dump();
    reads = [];
    const live = bundleFixture({ snapshot: snap, liveIssuerName: "RENAMED Issuer Co", liveTrn: "999999999999999" }) as unknown as { issuer: Record<string, string | null> };
    Object.assign(live.issuer, { address: "LIVE new address line", website: "www.live-changed.example", phone: "+999", email: "live@changed.example", logo_path: "company-logos/live-replaced-logo.png" });
    bundle = live;
    const after = await dump();
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toMatch(/RENAMED|LIVE|live-changed|999/);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.startsWith("quotation-assets/"))).toBe(true);   // only the pinned copy is ever read, never the live company-logos path
  });
  it("a new revision finalised from the edited profile shows the new values", async () => {
    const rev2 = snapshotFixture({ revision: 2, trn: "555000111", issuer: { address: "New Address Line 1\nNew Address Line 2", website: "www.new-site.example" } });
    bundle = bundleFixture({ snapshot: rev2 });
    const next = await dump();
    expect(next.xlsx).toContain("TRN: 555000111");
    expect(next.xlsx).toContain("New Address Line 2");
    expect(new Set(next.links)).toEqual(new Set(["https://www.new-site.example"]));
    expect(next.xlsx.join("\n")).not.toContain("100200300400003");
  });
  it("a draft renders the LIVE profile (branded) and stays marked Draft", async () => {
    bundle = bundleFixture({ draft: true, liveIssuerName: "Live Draft Issuer Ltd", liveTrn: "123123123" });
    (bundle as { issuer: Record<string, string | null> }).issuer = { ...(bundle as { issuer: Record<string, string | null> }).issuer, address: "Live Line A\nLive Line B", website: "www.live-draft.example", phone: "+000 99" };
    const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
    const ws = await sheet(xlsx);
    const cells = cellText(ws);
    expect(cells[0]).toMatch(/^DRAFT, NOT FINALISED/);
    expect(cells).toEqual(expect.arrayContaining(["Live Draft Issuer Ltd", "Live Line A", "Live Line B", "TRN: 123123123"]));
    expect(uris(pdf)).toEqual(onEveryPage(pdf, "https://www.live-draft.example"));
    if (hasPdftotext) { const t = flat(pdfPages(pdf).join(" ")); expect(t).toContain("DRAFT, NOT FINALISED"); expect(t).toContain("Sales enquiries: +000 99 · www.live-draft.example"); }
  });
  it("internal notes and the legal-review label stay out of the branded files", async () => {
    for (const b of [bundleFixture({ draft: true }), bundleFixture({ snapshot: snapshotFixture() })]) {
      bundle = b;
      const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
      for (const f of [pdf, xlsx]) { expect(f.toString("latin1")).not.toContain(INTERNAL_MARKER); }
      const text = [cellText(await sheet(xlsx)).join("\n"), ...(hasPdftotext ? pdfPages(pdf) : [])].join("\n");
      expect(text).not.toMatch(/pending legal review|working draft|estimate-format/i);
    }
  });
});

describe("how old and new documents are told apart", () => {
  it("the format marker of the frozen snapshot decides the layout: none = legacy, 1 = estimates-only layout, 2 = branded", () => {
    expect(ESTIMATE_FORMAT_MARKER).toBe("estimate-format:2");
    const m = (o: Parameters<typeof snapshotFixture>[0]) => modelFromSnapshot(snapshotFixture(o));
    expect(m({ legacy: true }).branded).toBe(false);
    expect(m({ label: "estimate-format:1" })).toMatchObject({ format: "estimate", branded: false, salesContact: null, addressLines: [] });
    expect(m({})).toMatchObject({ format: "estimate", branded: true });
    expect(m({}).salesContact!.text).toBe(SALES);
  });
  it("the snapshot already freezes the issuer fields and the pinned logo: the export reads them from the snapshot only", () => {
    const s = snapshotFixture({ logoSha: "a".repeat(64) });
    expect(Object.keys(s.issuer).sort()).toEqual(["address", "company_id", "country_code", "email", "legal_name", "logo", "phone", "trn", "website"]);
    expect(s.issuer.logo).toMatchObject({ bucket: "quotation-assets", sha256: "a".repeat(64) });
  });
});

interface Fx { snapshot: QuotationSnapshot; assets: Record<string, string>; golden: { pdfText: string; pdfPages: number; contentDisposition: { pdf: string; xlsx: string }; xlsx: { sheetName: string; cells: unknown[][]; imageCount: number; oddFooter: string; pageSetup: Record<string, unknown> } } }
const fx = JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", "estimate-frozen-v1.json"), "utf8")) as Fx;

describe("REGRESSION: an estimate finalised under estimate-format:1 (before issuer branding) re-exports exactly as it was", () => {
  beforeEach(() => {
    const stored = new Map(Object.entries(fx.assets).map(([p, b64]) => [`quotation-assets/${p}`, Buffer.from(b64, "base64") as Uint8Array]));
    exportSeams.storage = async (bk, p) => stored.get(`${bk}/${p}`) ?? null;
    // The live profile NOW has a website, a new address and a new logo: none of it may reach this old revision.
    const b = bundleFixture({ snapshot: structuredClone(fx.snapshot), liveIssuerName: "LIVE Name", liveTrn: "1" }) as unknown as { issuer: Record<string, string | null> };
    Object.assign(b.issuer, { address: "LIVE address", website: "www.live.example", phone: "+1", email: "live@live.example" });
    bundle = b;
  });
  it("is recognised as estimate-format:1 and not branded", () => {
    expect(fx.snapshot.terms.label).toBe("estimate-format:1");
    expect(modelFromSnapshot(fx.snapshot).branded).toBe(false);
  });
  it.skipIf(!hasPdftotext)("PDF: same text, page count and file name; no link annotation; no live data", async () => {
    const r = await run("pdf");
    expect(r.headers.get("content-disposition")).toBe(fx.golden.contentDisposition.pdf);
    const b = await buf(r);
    expect(spawnSync("pdftotext", ["-layout", tmp(b, "pdf"), "-"], { encoding: "utf8" }).stdout).toBe(fx.golden.pdfText);
    expect(pageCount(b)).toBe(fx.golden.pdfPages);
    expect(b.toString("latin1")).not.toMatch(/\/URI/);
  });
  it("Excel: same cells, row heights, picture count, print footer and file name; no hyperlink", async () => {
    const r = await run("xlsx");
    expect(r.headers.get("content-disposition")).toBe(fx.golden.contentDisposition.xlsx);
    const ws = await sheet(await buf(r));
    const cells: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => { const vals: unknown[] = []; row.eachCell({ includeEmpty: false }, (c, col) => vals.push([col, typeof c.value === "object" && c.value && "richText" in (c.value as object) ? (c.value as { richText: { text: string }[] }).richText.map((t) => t.text).join("") : c.value])); cells.push([n, row.height ?? null, vals]); });
    expect(ws.name).toBe(fx.golden.xlsx.sheetName);
    expect(cells).toEqual(fx.golden.xlsx.cells);
    expect(ws.getImages().length).toBe(fx.golden.xlsx.imageCount);
    expect(ws.headerFooter.oddFooter).toBe(fx.golden.xlsx.oddFooter);
  });
  it("exporting never alters the frozen snapshot", async () => {
    const before = JSON.stringify(fx.snapshot);
    await run("pdf"); await run("xlsx");
    expect(JSON.stringify((bundle as { snapshot: { content: QuotationSnapshot } }).snapshot.content)).toBe(before);
  });
});
