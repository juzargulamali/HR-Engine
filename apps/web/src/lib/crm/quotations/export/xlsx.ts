import ExcelJS from "exceljs";
import { NOTE_HEADINGS, reviewPricingSentence } from "@enginious-hr/domain";
import { exportBaseName, groupMoney, milestoneValueText, type DocLine, type QuotationDocModel } from "./doc-model";
import { imageSize, type ExportAssets } from "./images";

/**
 * Excel export of a quotation, one sheet, rendered from the same `QuotationDocModel` as the PDF (an issued revision's frozen snapshot, or a draft flagged DRAFT).
 * Amounts are real numeric cells (values, not formulas) with a currency number format; VAT rate is a percent; identifiers stay text so leading zeros survive;
 * every text cell is neutralised against spreadsheet formula injection. No internal field exists in the model, so none can be written.
 */
const COLS = [7, 52, 16, 9, 9, 14, 15, 9, 14, 15]; // # | Description | Image | Unit | Qty | Unit price | Excl. VAT | VAT rate | VAT amount | Incl. VAT
/** Estimate format: a wider photo column. 25 characters is 175 px; the photo box is 168 x 120 px = 44.5 x 31.8 mm (target: at least 40 x 30 mm), the row 96 pt. */
const COLS_ESTIMATE = [7, 46, 25, 9, 9, 14, 15, 9, 14, 15];
export const ESTIMATE_XLSX_PHOTO = { columnPx: 175, boxW: 168, boxH: 120, rowPt: 96 } as const;
const LAST = COLS.length;
const BRAND = "FF1C5C6B";
const THIN = { style: "thin" as const, color: { argb: "FFC9D3D7" } };

/** A leading = + - @ (or tab / carriage return) would be read as a formula by a spreadsheet: prefix it with an apostrophe so it stays text. */
export function neutralise(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

const linesNeeded = (text: string, charsPerLine: number) => text.split(/\r?\n/).reduce((n, p) => n + Math.max(1, Math.ceil(p.length / charsPerLine)), 0);
const num = (v: string) => Number(v);

export async function buildQuotationWorkbook(model: QuotationDocModel, assets: ExportAssets): Promise<Uint8Array> {
  const est = model.format === "estimate";
  const word = est ? "Estimate" : "Quotation";
  const wb = new ExcelJS.Workbook();
  wb.creator = model.issuer.legalName;
  wb.title = model.draft ? `${word} ${model.reference} revision ${model.revision} (DRAFT)` : `${word} ${model.reference} revision ${model.revision}`;
  const sheetName = model.draft ? `${word} DRAFT` : word;
  const ws = wb.addWorksheet(sheetName, { views: [{ showGridLines: false }] });
  ws.columns = (est ? COLS_ESTIMATE : COLS).map((width) => ({ width }));
  const cur = model.currency;
  const money = cur ? `"${cur}" #,##0.00` : "#,##0.00";
  const price = cur ? `"${cur}" #,##0.00##` : "#,##0.00##";
  const text = (row: number, col: number, value: string | null | undefined, opts: Partial<ExcelJS.Style> = {}) => {
    const c = ws.getCell(row, col);
    c.value = value == null || value === "" ? null : neutralise(value);
    c.alignment = { vertical: "top", wrapText: true, ...opts.alignment };
    if (opts.font) c.font = opts.font;
    return c;
  };
  const merged = (row: number, from: number, to: number, value: string | null | undefined, opts: Partial<ExcelJS.Style> = {}) => {
    if (to > from) ws.mergeCells(row, from, row, to);
    return text(row, from, value, opts);
  };

  let r = 1;
  if (model.draft) {
    ws.mergeCells(r, 1, r, LAST);
    const c = ws.getCell(r, 1);
    c.value = est ? "DRAFT, NOT FINALISED. This estimate has not been finalised and must not be sent to the client." : "DRAFT, NOT ISSUED. This estimate has not been issued and must not be sent to the client as a quotation.";
    c.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB42318" } };
    c.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(r).height = 22;
    r += 1;
  }

  // The mandatory notice (estimate format): the first thing on the sheet after the draft banner, merged across the table width, not part of any editable content.
  if (est && model.notice) {
    ws.mergeCells(r, 1, r, LAST);
    const c = ws.getCell(r, 1);
    c.value = { richText: [{ text: "BUDGETARY ESTIMATE\n", font: { bold: true, size: 10, color: { argb: "FF6B4F0A" } } }, { text: model.notice, font: { size: 11 } }] };
    c.alignment = { vertical: "top", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF5E3" } };
    const edge = { style: "thin" as const, color: { argb: "FFC7A24B" } };
    c.border = { top: edge, bottom: edge, left: edge, right: edge };
    ws.getRow(r).height = Math.max(48, (1 + linesNeeded(model.notice, 150)) * 15 + 6);
    r += 2;
  }

  // Header block: issuer (left, logo beside it) and document facts (right).
  const top = r;
  const i = model.issuer;
  const b = model.billTo;
  const left: [string, Partial<ExcelJS.Style>][] = [
    [i.legalName, { font: { bold: true, size: 13 } }],
    ...(i.trn ? ([[`TRN ${i.trn}`, {}]] as [string, Partial<ExcelJS.Style>][]) : []),
    ...(i.address ? ([[i.address, {}]] as [string, Partial<ExcelJS.Style>][]) : []),
    ...([[[i.phone, i.email, i.website].filter(Boolean).join("  ·  "), {}]] as [string, Partial<ExcelJS.Style>][]).filter(([t]) => t),
  ];
  const right: [string, Partial<ExcelJS.Style>][] = est ? [
    [model.draft ? "Estimate (DRAFT)" : "Estimate", { font: { bold: true, size: 16, color: { argb: BRAND } } }],
    [`Reference: ${model.reference}`, { font: { bold: true } }],
    [`Revision: ${model.revision}`, {}],
    [model.issueDate ? `Finalised on: ${model.issueDate}` : "Not finalised yet", {}],
    ...(model.validityDate ? ([[`Review pricing after: ${model.validityDate}`, {}]] as [string, Partial<ExcelJS.Style>][]) : []),
    [`Estimate total incl. VAT: ${cur ? `${cur} ` : ""}${groupMoney(model.totals.gross)}`, { font: { bold: true, color: { argb: BRAND } } }],
  ] : [
    [model.draft ? "Quotation (DRAFT)" : "Quotation", { font: { bold: true, size: 16, color: { argb: BRAND } } }],
    [`Reference: ${model.reference}`, { font: { bold: true } }],
    [`Revision: ${model.revision}`, {}],
    [model.issueDate ? `Issue date: ${model.issueDate}` : "Issue date: not issued yet", {}],
    [model.validityDate ? `Valid until: ${model.validityDate}` : "Validity: not set", {}],
  ];
  const billTo: [string, Partial<ExcelJS.Style>][] = [
    [est ? "PREPARED FOR" : "BILL TO", { font: { bold: true, size: 9, color: { argb: "FF4A5D66" } } }],
    [b.name, { font: { bold: true, size: 12 } }],
    ...([[[b.place, b.country].filter(Boolean).join(", "), {}]] as [string, Partial<ExcelJS.Style>][]).filter(([t]) => t),
    ...(b.vatTrn ? ([[`VAT registration number / TRN: ${b.vatTrn}`, {}]] as [string, Partial<ExcelJS.Style>][]) : []),
    ...(b.tradeLicence ? ([[`Trade licence number: ${b.tradeLicence}`, {}]] as [string, Partial<ExcelJS.Style>][]) : []),
  ];
  const project: [string, Partial<ExcelJS.Style>][] = [
    ["PROJECT / ENQUIRY", { font: { bold: true, size: 9, color: { argb: "FF4A5D66" } } }],
    [model.enquiryTitle, { font: { bold: true, size: 12 } }],
    [`Enquiry ${model.enquiryReference}`, {}],
    [cur ? `All amounts in ${cur}` : "Currency not chosen yet", {}],
  ];
  const n1 = Math.max(left.length, right.length, 4);
  for (let k = 0; k < n1; k++) {
    if (left[k]) merged(top + k, 1, 2, left[k]![0], left[k]![1]);
    if (right[k]) merged(top + k, 6, LAST, right[k]![0], right[k]![1]);
  }
  const top2 = top + n1 + 1;
  const n2 = Math.max(billTo.length, project.length);
  for (let k = 0; k < n2; k++) {
    if (billTo[k]) merged(top2 + k, 1, 2, billTo[k]![0], billTo[k]![1]);
    if (project[k]) merged(top2 + k, 6, LAST, project[k]![0], project[k]![1]);
  }
  for (let k = top; k < top + n1; k++) ws.getRow(k).height = k === top ? 24 : 16;
  // The logo sits in the Image column beside the issuer lines.
  const logoId = assets.logo ? wb.addImage({ buffer: assets.logo.data as never, extension: assets.logo.format === "jpg" ? "jpeg" : "png" }) : null;
  if (logoId !== null) {
    const sz = imageSize(assets.logo!) ?? { width: 100, height: 60 };
    const scale = Math.min(110 / sz.width, 62 / sz.height, 1);
    ws.addImage(logoId, { tl: { col: 2.1, row: top - 1 + 0.1 }, ext: { width: Math.round(sz.width * scale), height: Math.round(sz.height * scale) }, editAs: "oneCell" });
  }

  // The BOQ table.
  r = top2 + n2 + 1;
  const headerRow = r;
  ["#", "Description", est ? "Photo" : "Image", "Unit", "Qty", "Unit price", "Excl. VAT", "VAT rate", "VAT amount", "Incl. VAT"].forEach((h, k) => {
    const c = ws.getCell(r, k + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    c.alignment = { vertical: "middle", horizontal: k >= 4 ? "right" : k === 2 ? "center" : "left", wrapText: true };
    c.border = { bottom: THIN };
  });
  ws.getRow(r).height = 20;
  r += 1;

  const imageIds = new Map<string, number>();
  const border = { bottom: THIN };
  const lineRow = (l: DocLine) => {
    ws.getCell(r, 1).value = l.number;   // text: "1.10" must stay "1.10"
    ws.getCell(r, 1).alignment = { vertical: "top" };
    text(r, 2, l.description);
    text(r, 4, l.unit);
    ws.getCell(r, 5).value = num(l.quantity); ws.getCell(r, 5).numFmt = "#,##0.###";
    ws.getCell(r, 6).value = num(l.unitPrice); ws.getCell(r, 6).numFmt = price;
    ws.getCell(r, 7).value = num(l.net); ws.getCell(r, 7).numFmt = money;
    if (l.vatRate != null) { ws.getCell(r, 8).value = num(l.vatRate) / 100; ws.getCell(r, 8).numFmt = "0.##%"; } else text(r, 8, l.vatLabel);
    ws.getCell(r, 9).value = num(l.vatAmount); ws.getCell(r, 9).numFmt = money;
    ws.getCell(r, 10).value = num(l.gross); ws.getCell(r, 10).numFmt = money;
    for (let c = 1; c <= LAST; c++) { const cell = ws.getCell(r, c); cell.border = border; if (c >= 5) cell.alignment = { vertical: "top", horizontal: "right", wrapText: c === 8 }; }
    let h = Math.max(20, linesNeeded(l.description, est ? 44 : 50) * 15 + 4);
    const img = l.image ? assets.images.get(l.image.key) : undefined;
    if (img) {
      let id = imageIds.get(l.image!.key);
      if (id === undefined) { id = wb.addImage({ buffer: img.data as never, extension: img.format === "jpg" ? "jpeg" : "png" }); imageIds.set(l.image!.key, id); }
      const sz = imageSize(img) ?? { width: 80, height: 80 };
      if (est) {
        // Contain: scale so the whole picture fits the photo box, never stretched; centred in the column; the row is tall enough for the box.
        const P = ESTIMATE_XLSX_PHOTO;
        const scale = Math.min(P.boxW / sz.width, P.boxH / sz.height);
        const w = Math.round(sz.width * scale);
        const hh = Math.round(sz.height * scale);
        ws.addImage(id, { tl: { col: 2 + (P.columnPx - w) / 2 / P.columnPx, row: r - 1 + (P.rowPt / 0.75 - hh) / 2 / (P.rowPt / 0.75) }, ext: { width: w, height: hh }, editAs: "oneCell" });
        h = Math.max(h, P.rowPt);
      } else {
        const scale = Math.min(80 / sz.width, 62 / sz.height);
        const w = Math.round(sz.width * scale);
        const hh = Math.round(sz.height * scale);
        ws.addImage(id, { tl: { col: 2 + (112 - w) / 2 / 112, row: r - 1 + 0.05 }, ext: { width: w, height: hh }, editAs: "oneCell" });
        h = Math.max(h, 68);
      }
    }
    ws.getRow(r).height = h;
    r += 1;
  };
  for (const sec of model.sections) {
    const loose = sec.title === null;   // the hidden default section: no heading and no subtotal row
    if (!loose) {
      ws.mergeCells(r, 1, r, LAST);
      const c = text(r, 1, `${sec.number} ${sec.title}`, { font: { bold: true } });
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE8EB" } };
      ws.getRow(r).height = Math.max(20, linesNeeded(`${sec.number} ${sec.title}`, 150) * 15 + 4);
      r += 1;
    }
    sec.lines.forEach(lineRow);
    if (loose) continue;
    text(r, 2, `Subtotal: ${sec.number} ${sec.title}`, { font: { bold: true }, alignment: { horizontal: "right", vertical: "top", wrapText: true } });
    ([[7, sec.subtotalNet], [9, sec.subtotalVat], [10, sec.subtotalGross]] as const).forEach(([col, v]) => { const x = ws.getCell(r, col); x.value = num(v); x.numFmt = money; x.font = { bold: true }; });
    for (let c2 = 1; c2 <= LAST; c2++) { const cell = ws.getCell(r, c2); cell.border = border; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF3F4" } }; }
    ws.getRow(r).height = Math.max(20, linesNeeded(`Subtotal: ${sec.number} ${sec.title}`, 50) * 15 + 4);
    r += 1;
  }

  // Totals block.
  r += 1;
  ([["Total excl. VAT", model.totals.net, false], ["VAT", model.totals.vat, false], ["Total incl. VAT", model.totals.gross, true]] as const).forEach(([label, v, big]) => {
    ws.mergeCells(r, 6, r, 9);
    const l = text(r, 6, label, { font: { bold: true, ...(big ? { size: 12, color: { argb: BRAND } } : {}) }, alignment: { horizontal: "right", vertical: "middle", wrapText: false } });
    void l;
    const x = ws.getCell(r, 10);
    x.value = num(v); x.numFmt = money; x.font = { bold: true, ...(big ? { size: 12, color: { argb: BRAND } } : {}) };
    if (est) {
      // A clearly boxed totals block right after the table: outline around the label and amount cells, light band behind them.
      const edge = { style: "thin" as const, color: { argb: BRAND } };
      for (let c2 = 6; c2 <= 10; c2++) {
        const cell = ws.getCell(r, c2);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF3F4" } };
        cell.border = { left: c2 === 6 ? edge : undefined, right: c2 === 10 ? edge : undefined, top: label === "Total excl. VAT" ? edge : label === "Total incl. VAT" ? THIN : undefined, bottom: big ? edge : undefined };
      }
      ws.getRow(r).height = big ? 24 : 18;
    }
    r += 1;
  });
  if (est && model.validityDate) {
    r += 1;
    merged(r, 6, LAST, reviewPricingSentence(model.validityDate), { font: { italic: true, color: { argb: "FF4A5D66" } }, alignment: { horizontal: "right", vertical: "top", wrapText: true } });
    ws.getRow(r).height = 32;
    r += 1;
  }

  // Payment milestones.
  if (model.milestones.length > 0) {
    r += 1;
    merged(r, 1, LAST, est ? "Indicative payment schedule" : "Payment milestones", { font: { bold: true, size: 12, color: { argb: BRAND } } });
    r += 1;
    const head = (col: number, from: number, to: number, label: string) => { if (to > from) ws.mergeCells(r, from, r, to); const c = ws.getCell(r, col); c.value = label; c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF3F4" } }; };
    head(2, 2, 2, est ? "Item" : "Milestone"); head(3, 3, 5, est ? "Timing" : "Due"); head(6, 6, 6, "Share"); head(7, 7, 7, "Amount incl. VAT");
    r += 1;
    for (const m of model.milestones) {
      text(r, 2, m.label);
      merged(r, 3, 5, m.due);
      if (m.kind === "percent") { const c = ws.getCell(r, 6); c.value = num(m.value) / 100; c.numFmt = "0.##%"; c.alignment = { horizontal: "right", vertical: "top" }; }
      const a = ws.getCell(r, 7); a.value = num(m.amount); a.numFmt = money; a.alignment = { vertical: "top" };
      ws.getRow(r).height = Math.max(20, linesNeeded(m.label, 50) * 15 + 4);
      r += 1;
    }
  }

  // Optional client notes (estimate format): a heading and wrapped paragraphs; an empty block prints nothing, not even its heading.
  const notes = (heading: string, paragraphs: string[]) => {
    if (paragraphs.length === 0) return;
    r += 1;
    merged(r, 1, LAST, heading, { font: { bold: true, size: 12, color: { argb: BRAND } } });
    r += 1;
    for (const p of paragraphs) {
      merged(r, 1, LAST, p);
      ws.getRow(r).height = Math.max(20, linesNeeded(p, 150) * 15 + 4);
      r += 1;
    }
  };
  if (est) notes(NOTE_HEADINGS.assumptions, model.clientNotes.assumptions);

  // Exclusions: their own block (before the terms in a legacy document).
  if (model.exclusions.length > 0) {
    r += 1;
    merged(r, 1, LAST, "Exclusions", { font: { bold: true, size: 12, color: { argb: BRAND } } });
    r += 1;
    model.exclusions.forEach((cl, k) => {
      ws.mergeCells(r, 1, r, LAST);
      const c = ws.getCell(r, 1);
      c.value = { richText: [{ text: `${k + 1}. ${neutralise(cl.title)}\n`, font: { bold: true } }, { text: neutralise(cl.body) }] };
      c.alignment = { vertical: "top", wrapText: true };
      ws.getRow(r).height = Math.max(20, (1 + linesNeeded(cl.body, 140)) * 15 + 4);
      r += 1;
    });
  }

  if (est) notes(NOTE_HEADINGS.nextSteps, model.clientNotes.nextSteps);

  // Terms and conditions as wrapped text rows (legacy documents only: an estimate has none).
  if (model.terms.clauses.length > 0) {
    r += 1;
    merged(r, 1, LAST, "Terms and conditions", { font: { bold: true, size: 12, color: { argb: BRAND } } });
    r += 1;
    if (model.terms.label) { merged(r, 1, LAST, model.terms.label, { font: { italic: true, color: { argb: "FF4A5D66" } } }); r += 1; }
    model.terms.clauses.forEach((cl, k) => {
      ws.mergeCells(r, 1, r, LAST);
      const c = ws.getCell(r, 1);
      c.value = { richText: [{ text: `${k + 1}. ${neutralise(cl.title)}\n`, font: { bold: true } }, { text: neutralise(cl.body) }] };
      c.alignment = { vertical: "top", wrapText: true };
      ws.getRow(r).height = Math.max(20, (1 + linesNeeded(cl.body, 140)) * 15 + 4);
      r += 1;
    });
  }

  // A legacy sheet freezes its header rows. An estimate does not: its mandatory notice and header block are tall, and freezing them would leave no room to scroll.
  ws.views = est ? [{ showGridLines: false }] : [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headerRow}:${headerRow}`, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  ws.headerFooter = { oddFooter: `&L${model.draft ? "DRAFT  " : ""}${est ? "Estimate " : ""}${model.reference.replace(/&/g, "&&")} rev ${model.revision}&RPage &P of &N` };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export { exportBaseName, milestoneValueText };
