// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculate, type QuotationHeader } from "../model";
import { BUCKETS_UNUSED } from "./test-support";
import { INTERNAL_MARKER, OPP, PROPOSAL, bundleFixture, png, sha256, snapshotFixture } from "./test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("storage must go through the seam in tests"); } }));
let ctx: unknown;
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));
let bundle: unknown;
vi.mock("../data", () => ({ loadQuotation: async () => { if (bundle instanceof Error) throw bundle; return bundle; } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { reference: "ENQ-FIX-2026-0007", title: "Fictional draft enquiry" }, error: null }) }) }) }) }) }));

import { exportSeams, quotationExport } from "./handler";
import { exportBaseName, modelFromDraft, modelFromSnapshot } from "./doc-model";
import { loadExportAssets, normaliseImage, type StorageReader } from "./images";
import { buildQuotationWorkbook, neutralise } from "./xlsx";
import { pinAssets, type PinStorage } from "../pin-assets";
void BUCKETS_UNUSED;

const hasPdftotext = spawnSync("pdftotext", ["-v"]).error === undefined;
const granted = { userId: "u", grants: [{ companyId: "22222222-2222-4222-8222-222222222222", capabilities: [] }], companies: [] };
const ids = (kind: "pdf" | "xlsx") => [PROPOSAL, kind] as const;
const run = async (kind: "pdf" | "xlsx") => quotationExport(...ids(kind));
const buf = async (r: Response) => Buffer.from(await r.arrayBuffer());
function pdfText(b: Buffer): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "quo-"));
  const f = path.join(dir, "q.pdf");
  writeFileSync(f, b);
  return spawnSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" }).stdout;
}
const pageCount = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
async function sheet(b: Buffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(b as never); return wb; }
const cellText = (ws: ExcelJS.Worksheet) => { const out: string[] = []; ws.eachRow((row) => row.eachCell((c) => out.push(typeof c.value === "object" && c.value && "richText" in c.value ? c.value.richText.map((t) => t.text).join("") : String(c.value ?? "")))); return out; };
const rowWith = (ws: ExcelJS.Worksheet, re: RegExp) => { let found: ExcelJS.Row | undefined; ws.eachRow((row) => { if (!found && row.values && (row.values as unknown[]).some((v) => typeof v === "string" && re.test(v))) found = row; }); return found; };

let stored: Map<string, Uint8Array>;
const storage: StorageReader = async (bucket, p) => stored.get(`${bucket}/${p}`) ?? null;

beforeEach(() => { ctx = granted; bundle = bundleFixture({ snapshot: snapshotFixture() }); stored = new Map(); exportSeams.storage = storage; });

describe("totals agree everywhere (direct client and agency billed)", () => {
  for (const agency of [false, true]) {
    it(`${agency ? "agency-billed" : "direct-client"}: PDF and XLSX show the snapshot's totals, section subtotals, numbering and Exclusions before Terms`, async () => {
      const snap = snapshotFixture({ agency });
      bundle = bundleFixture({ snapshot: snap });
      const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
      const ws = (await sheet(xlsx)).worksheets[0]!;
      const total = rowWith(ws, /^Total incl\. VAT$/)!;
      expect([Number(rowWith(ws, /^Total excl\. VAT$/)!.getCell(10).value), Number(rowWith(ws, /^VAT$/)!.getCell(10).value), Number(total.getCell(10).value)]).toEqual([Number(snap.totals.net), Number(snap.totals.vat), Number(snap.totals.gross)]);
      for (const sec of snap.sections) {
        const r = rowWith(ws, new RegExp(`^Subtotal: ${sec.number} ${sec.title}$`))!;
        expect([r.getCell(7).value, r.getCell(9).value, r.getCell(10).value]).toEqual([Number(sec.subtotal_net), Number(sec.subtotal_vat), Number(sec.subtotal_gross)]);
        expect(rowWith(ws, new RegExp(`^${sec.number} ${sec.title}$`))).toBeTruthy();
      }
      expect(cellText(ws)).toEqual(expect.arrayContaining(["1.1", "1.2", "2.1", snap.bill_to.name]));
      const t = cellText(ws);
      expect(t.indexOf("Exclusions")).toBeGreaterThan(t.indexOf("Payment milestones"));
      expect(t.indexOf("Terms and conditions")).toBeGreaterThan(t.indexOf("Exclusions"));
      if (hasPdftotext) {
        const text = pdfText(pdf);
        for (const v of [snap.totals.net, snap.totals.vat, snap.totals.gross, ...snap.sections.flatMap((s) => [s.subtotal_net, s.subtotal_vat, s.subtotal_gross])]) expect(text).toContain(v.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
        expect(text).toContain(snap.bill_to.name);
        expect(text).toMatch(/1\.1\s+Stage deck/);
        expect(text.indexOf("Exclusions")).toBeGreaterThan(text.indexOf("Payment milestones"));
        expect(text.indexOf("Terms and conditions")).toBeGreaterThan(text.indexOf("Exclusions"));
        expect(text).toMatch(/Page 1 of 2/);
      }
    });
  }
  it("the document model carries the snapshot totals unchanged", () => {
    const snap = snapshotFixture();
    expect(modelFromSnapshot(snap).totals).toEqual(snap.totals);
  });
});

describe("identifiers and rounding", () => {
  it("leading zeros of the TRN and trade licence appear exactly (model, PDF text, XLSX text cells)", async () => {
    const m = modelFromSnapshot(snapshotFixture());
    expect([m.billTo.vatTrn, m.billTo.tradeLicence]).toEqual(["000123450001", "0045"]);
    const ws = (await sheet(await buf(await run("xlsx")))).worksheets[0]!;
    const vatRow = rowWith(ws, /VAT registration number \/ TRN: 000123450001/);
    expect(vatRow).toBeTruthy();
    expect(rowWith(ws, /Trade licence number: 0045$/)).toBeTruthy();
    if (hasPdftotext) { const t = pdfText(await buf(await run("pdf"))); expect(t).toContain("VAT registration number / TRN: 000123450001"); expect(t).toContain("Trade licence number: 0045"); }
  });
  it("an absent issuer TRN is omitted, not printed blank", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ trn: null }) });
    const ws = (await sheet(await buf(await run("xlsx")))).worksheets[0]!;
    expect(cellText(ws).some((t) => /^TRN/.test(t))).toBe(false);
    if (hasPdftotext) expect(pdfText(await buf(await run("pdf")))).not.toMatch(/\bTRN\s*$/m);
  });
  it("3 x 33.33 with 5% VAT is 99.99 + 5.00 = 104.99 in the builder, the snapshot, the PDF model and the XLSX", async () => {
    const h = { ...bundleFixture({ draft: true }).header } as QuotationHeader;
    const b = bundleFixture({ draft: true });
    const built = calculate(h, b.sections, b.lines);
    expect([built.net, built.vat, built.gross]).toEqual(["99.99", "5.00", "104.99"]);
    const snap = snapshotFixture();
    expect(snap.sections[0]!.lines[0]).toMatchObject({ number: "1.1", amount_net: "99.99", vat_amount: "5.00", amount_gross: "104.99" });
    const draftModel = modelFromDraft({ header: h, sections: b.sections, lines: b.lines, issuer: b.issuer, files: [], billTo: null, enquiry: { reference: "E", title: "T" } });
    expect(draftModel.sections[0]!.lines[0]).toMatchObject({ number: "1.1", net: "99.99", vatAmount: "5.00", gross: "104.99" });
    expect(modelFromSnapshot(snap).sections[0]!.lines[0]).toMatchObject({ net: "99.99", vatAmount: "5.00", gross: "104.99" });
    const ws = (await sheet(await buf(await run("xlsx")))).worksheets[0]!;
    const r = rowWith(ws, /^1\.1$/)!;
    expect([r.getCell(5).value, r.getCell(6).value, r.getCell(7).value, r.getCell(8).value, r.getCell(9).value, r.getCell(10).value]).toEqual([3, 33.33, 99.99, 0.05, 5, 104.99]);
  });
});

describe("draft marking and file names", () => {
  it("a draft is marked Draft in the PDF (banner, watermark, title) and the XLSX (banner row, sheet name), with a -DRAFT file name; issued exports are not marked", async () => {
    bundle = bundleFixture({ draft: true });
    const [dp, dx] = [await run("pdf"), await run("xlsx")];
    expect(dp.headers.get("content-disposition")).toBe('attachment; filename="QUO-FIX-2026-0001-rev1-DRAFT.pdf"');
    expect(dx.headers.get("content-disposition")).toBe('attachment; filename="QUO-FIX-2026-0001-rev1-DRAFT.xlsx"');
    const [pdf, xlsx] = [await buf(dp), await buf(dx)];
    const wb = await sheet(xlsx);
    expect(wb.worksheets[0]!.name).toBe("Quotation DRAFT");
    expect(String(wb.worksheets[0]!.getCell(1, 1).value)).toMatch(/^DRAFT, NOT ISSUED/);
    if (hasPdftotext) { const t = pdfText(pdf); expect(t).toMatch(/DRAFT, NOT ISSUED/); expect(t).toContain("Quotation (DRAFT)"); }
    bundle = bundleFixture({ snapshot: snapshotFixture({ revision: 3 }) });
    const [ip, ix] = [await run("pdf"), await run("xlsx")];
    expect(ip.headers.get("content-disposition")).toBe('attachment; filename="QUO-FIX-2026-0001-rev3.pdf"');
    expect(ix.headers.get("content-disposition")).toBe('attachment; filename="QUO-FIX-2026-0001-rev3.xlsx"');
    const iwb = await sheet(await buf(ix));
    expect(iwb.worksheets[0]!.name).toBe("Quotation");
    expect(cellText(iwb.worksheets[0]!).some((t) => /DRAFT/.test(t))).toBe(false);
    if (hasPdftotext) expect(pdfText(await buf(ip))).not.toMatch(/DRAFT/);
    expect(ix.headers.get("cache-control")).toBe("private, no-store");
    expect(ip.headers.get("x-content-type-options")).toBe("nosniff");
    expect(exportBaseName({ reference: "A/B C", revision: 2, draft: false })).toBe("A-B-C-rev2");
  });
});

describe("internal fields never appear", () => {
  it("a unique marker in the internal notes is absent from both exports of a draft and of an issued revision", async () => {
    for (const b of [bundleFixture({ draft: true }), bundleFixture({ snapshot: snapshotFixture() })]) {
      bundle = b;
      expect(b.header.internal_notes).toBe(INTERNAL_MARKER);
      const [pdf, xlsx] = [await buf(await run("pdf")), await buf(await run("xlsx"))];
      expect(pdf.toString("latin1")).not.toContain(INTERNAL_MARKER);
      expect(xlsx.toString("latin1")).not.toContain(INTERNAL_MARKER);
      expect(cellText((await sheet(xlsx)).worksheets[0]!).join("\n")).not.toContain(INTERNAL_MARKER);
      if (hasPdftotext) expect(pdfText(pdf)).not.toContain(INTERNAL_MARKER);
      expect(JSON.stringify(b.header.internal_notes ? modelFromDraft({ header: b.header, sections: b.sections, lines: b.lines, issuer: b.issuer, files: [], billTo: null, enquiry: { reference: "E", title: "T" } }) : {})).not.toContain(INTERNAL_MARKER);
    }
  });
});

describe("an issued revision's export is frozen", () => {
  it("is unchanged after the account, the issuer profile and the terms are edited; a new revision shows the new values", async () => {
    const snap = snapshotFixture();
    bundle = bundleFixture({ snapshot: snap });
    const dump = async () => { const x = await buf(await run("xlsx")); const w = (await sheet(x)).worksheets[0]!; return { cells: cellText(w), pdf: hasPdftotext ? pdfText(await buf(await run("pdf"))) : "" }; };
    const before = await dump();
    bundle = bundleFixture({ snapshot: snap, liveIssuerName: "RENAMED Issuer Co", liveBillName: "RENAMED Account", liveTrn: "123" });
    const after = await dump();
    expect(after).toEqual(before);
    expect(after.cells.join("\n")).not.toMatch(/RENAMED|LIVE/);
    const rev2 = snapshotFixture({ revision: 2, issuerName: "RENAMED Issuer Co", billName: "RENAMED Account", trn: "123" });
    bundle = bundleFixture({ snapshot: rev2 });
    const next = await dump();
    expect(next.cells.join("\n")).toContain("RENAMED Account");
    expect(next.cells.join("\n")).toContain("TRN 123");
  });
  it("a superseded revision exports from its own snapshot, labelled with its revision", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ revision: 1 }) });
    (bundle as { proposal: { status: string } }).proposal = { status: "superseded" } as never;
    const r = await run("xlsx");
    expect(r.headers.get("content-disposition")).toMatch(/rev1\.xlsx/);
  });
});

describe("pagination", () => {
  it("a 60-line BOQ with a long description runs over several pages, the table header repeats, rows are not cut", async () => {
    bundle = bundleFixture({ snapshot: snapshotFixture({ lines60: true, longDescription: true }) });
    const pdf = await buf(await run("pdf"));
    expect(pageCount(pdf)).toBeGreaterThan(2);
    if (hasPdftotext) {
      const pages = pdfText(pdf).split("\f").filter((p) => p.trim());
      const boq = pages.filter((p) => /Excl\. VAT/.test(p) && /Description/.test(p));
      expect(boq.length).toBeGreaterThanOrEqual(2);   // the header row is on every BOQ page
      expect(pages.length).toBe(pageCount(pdf));
      expect(pdfText(pdf)).toMatch(/Page 2 of \d+/);
      // every item appears exactly once
      for (const n of [1, 30, 60]) expect((pdfText(pdf).match(new RegExp(`\\b1\\.${n}\\s+Item ${n}\\b`, "g")) ?? []).length).toBe(1);
    }
    const ws = (await sheet(await buf(await run("xlsx")))).worksheets[0]!;
    expect(ws.pageSetup).toMatchObject({ orientation: "landscape", fitToWidth: 1, fitToHeight: 0 });
    expect(ws.pageSetup.printTitlesRow).toMatch(/^\d+:\d+$/);
    expect(ws.views[0]).toMatchObject({ state: "frozen" });
    const long = rowWith(ws, /Item 6 Custom stage deck/)!;
    expect(long.height).toBeGreaterThan(60);   // a long description gets a taller row
  });
});

describe("pictures", () => {
  it("embeds pinned item pictures and the logo; a missing or corrupt picture is left out without breaking the export", async () => {
    const a = await png("#cc3322"); const b = await png("#2233cc"); const logo = await png("#118833", 120, 80);
    const snap = snapshotFixture({ withImages: [{ lineNumber: "1.1", sha: sha256(a) }, { lineNumber: "1.2", sha: sha256(b) }], logoSha: sha256(logo) });
    stored.set(`quotation-assets/${snap.sections[0]!.lines[0]!.image!.storage_path}`, a);
    stored.set(`quotation-assets/${snap.issuer.logo!.storage_path}`, logo);
    // item 1.2: bytes at the path do not match the recorded hash (tampered) -> not embedded
    stored.set(`quotation-assets/${snap.sections[0]!.lines[1]!.image!.storage_path}`, Buffer.from("not an image"));
    bundle = bundleFixture({ snapshot: snap });
    const [rp, rx] = [await run("pdf"), await run("xlsx")];
    expect([rp.status, rx.status]).toEqual([200, 200]);
    expect(rp.headers.get("x-quotation-pictures-missing")).toBe("1");
    const ws = (await sheet(await buf(rx))).worksheets[0]!;
    expect(ws.getImages().length).toBe(2);   // one item picture + the logo
    expect((await buf(rp)).toString("latin1").match(/\/Subtype \/Image/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it("an issued revision re-exports with its ORIGINAL logo and pictures after the company logo is replaced or removed and a source picture changes", async () => {
    const orig = await png("#cc3322"); const origLogo = await png("#118833", 120, 80);
    const snap = snapshotFixture({ withImages: [{ lineNumber: "1.1", sha: sha256(orig) }], logoSha: sha256(origLogo) });
    // The snapshot references only pinned, content-addressed copies owned by the revision, never the mutable sources.
    expect(snap.issuer.logo!.bucket).toBe("quotation-assets");
    expect(snap.issuer.logo!.storage_path).toBe(`${PROPOSAL}/logo-${sha256(origLogo)}.png`);
    expect(JSON.stringify(snap)).not.toMatch(/company-logos|crm-files/);
    const model = modelFromSnapshot(snap);
    stored.set(`quotation-assets/${snap.issuer.logo!.storage_path}`, origLogo);
    stored.set(`quotation-assets/${snap.sections[0]!.lines[0]!.image!.storage_path}`, orig);
    const first = await loadExportAssets(model, storage);
    // the company replaces, then removes, its logo; the source picture row changes
    stored.set(`company-logos/${COMPANY_LOGO}`, await png("#000000"));
    stored.set("crm-files/source-picture", await png("#ffffff"));
    const second = await loadExportAssets(model, storage);
    stored.delete(`company-logos/${COMPANY_LOGO}`);
    const third = await loadExportAssets(model, storage);
    for (const a of [second, third]) {
      expect(a.logo!.data.equals(first.logo!.data)).toBe(true);
      expect(a.images.get("file-1.1")!.data.equals(first.images.get("file-1.1")!.data)).toBe(true);
    }
    expect(first.logo!.data.equals((await normaliseImage(origLogo))!.data)).toBe(true);
    expect(first.missing).toBe(0);
  });
});

const COMPANY_LOGO = "22222222-2222-4222-8222-222222222222/live-logo.png";

describe("pinning at issue (storage seam; real object storage is NOT exercised here)", () => {
  const fake = (files: Record<string, Uint8Array>): PinStorage & { puts: string[] } => {
    const puts: string[] = [];
    return { puts, read: async (b, p) => files[`${b}/${p}`] ?? null, put: async (p) => { puts.push(p); return true; } };
  };
  it("copies the logo and item pictures to content-addressed paths owned by the revision and returns hashes", async () => {
    const logo = await png("#118833"); const pic = await png("#cc3322");
    const st = fake({ [`company-logos/${COMPANY_LOGO}`]: logo, "crm-files/src/pic": pic });
    const r = await pinAssets({ proposalId: PROPOSAL, logo: { bucket: "company-logos", path: COMPANY_LOGO }, lines: [{ lineId: "L1", position: "1.1", bucket: "crm-files", path: "src/pic" }] }, st);
    if ("error" in r) throw new Error(r.error);
    expect(r.assets.logo).toEqual({ path: `${PROPOSAL}/logo-${sha256(logo)}.png`, sha256: sha256(logo), mime_type: "image/png" });
    expect(r.assets.lines.L1).toEqual({ path: `${PROPOSAL}/line-L1-${sha256(pic)}.png`, sha256: sha256(pic), mime_type: "image/png" });
    expect(st.puts).toHaveLength(2);
  });
  it("refuses to issue (says which picture) when a source cannot be read or is not an image", async () => {
    const bad = await pinAssets({ proposalId: PROPOSAL, logo: null, lines: [{ lineId: "L1", position: "2.3", bucket: "crm-files", path: "gone" }] }, fake({}));
    expect(bad).toEqual({ error: expect.stringMatching(/picture of item 2\.3 could not be read/) });
    const notImage = await pinAssets({ proposalId: PROPOSAL, logo: { bucket: "company-logos", path: "x" }, lines: [] }, fake({ "company-logos/x": Buffer.from("MZ not an image") }));
    expect(notImage).toEqual({ error: expect.stringMatching(/company logo could not be read/) });
  });
});

describe("XLSX cell rules", () => {
  it("neutralises formula injection, keeps numbers numeric with currency formats and VAT as a percent, and leaves identifiers as text", async () => {
    expect(["=1+1", "+971 4", "-5 dB", "@SUM(A1)", "plain", "0045"].map(neutralise)).toEqual(["'=1+1", "'+971 4", "'-5 dB", "'@SUM(A1)", "plain", "0045"]);
    const snap = snapshotFixture();
    snap.sections[0]!.lines[0]!.description = "=HYPERLINK(\"http://evil\",\"x\")";
    snap.bill_to.name = "@Evil Client";
    bundle = bundleFixture({ snapshot: snap });
    const ws = (await sheet(await buf(await run("xlsx")))).worksheets[0]!;
    const t = cellText(ws);
    expect(t).toContain("'=HYPERLINK(\"http://evil\",\"x\")");
    expect(t).toContain("'@Evil Client");
    const r = rowWith(ws, /^1\.2$/)!;
    expect(typeof r.getCell(7).value).toBe("number");
    expect(r.getCell(7).numFmt).toBe('"EUR" #,##0.00');
    expect(r.getCell(8).numFmt).toBe("0.##%");
    expect(r.getCell(8).value).toBe(0.15);
    const tr = rowWith(ws, /^1\.1$/)!;
    expect(typeof tr.getCell(1).value).toBe("string");
    const bill = rowWith(ws, /Trade licence number/)!;
    expect(typeof (bill.values as unknown[]).find((v) => typeof v === "string" && /0045/.test(v))).toBe("string");
  });
});

describe("permissions and failures", () => {
  it("signed out 401; a person without Sales access 403; another company 403; an unreadable quotation 404; a failed read 503; an issued quotation without its snapshot 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ctx = null; expect((await run("pdf")).status).toBe(401);
    ctx = { ...granted, grants: [] }; expect((await run("xlsx")).status).toBe(403);
    ctx = { ...granted, loadFailed: true, grants: [] }; expect((await run("pdf")).status).toBe(503);
    ctx = { ...granted, grants: [{ companyId: "99999999-9999-4999-8999-999999999999", capabilities: [] }] }; expect((await run("xlsx")).status).toBe(403);
    ctx = granted; bundle = null; expect((await run("pdf")).status).toBe(404);
    bundle = new Error("db down"); const r = await run("xlsx"); expect(r.status).toBe(503); expect(await r.text()).toMatch(/could not be loaded/);
    bundle = bundleFixture({ snapshot: null }); bundle = { ...(bundle as object), header: { ...(bundle as { header: object }).header, issued_at: "2026-11-02T00:00:00Z" }, snapshot: null };
    expect((await run("pdf")).status).toBe(503);
    expect((await quotationExport("not-a-uuid", "pdf")).status).toBe(404);
    void OPP;
  });
});
