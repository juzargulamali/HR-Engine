import ExcelJS from "exceljs";

/**
 * Reading and writing .xlsx for the Clients & Agencies import and export. Reading takes cell VALUES only: a formula cell yields its
 * stored result as text and nothing is ever evaluated. Everything read is untrusted text.
 */

/** 4 MB: under the 4.5 MB request-body cap of the hosting platform, so the person sees our message and not a platform error. */
export const IMPORT_LIMITS = { maxBytes: 4 * 1024 * 1024, maxRows: 2000, maxColumns: 40, maxCellChars: 2000, maxUncompressedBytes: 40 * 1024 * 1024, maxEntries: 200 } as const;

export const TEMPLATE_HEADERS = [
  "Organisation name", "Country", "Organisation type", "Website", "Contact name", "Contact title", "Contact email", "Contact phone",
  "Lead source / exhibition", "Notes", "Account owner work email",
] as const;
export const ORGANISATIONS_SHEET = "Organisations";
export const SUMMARY_SHEET = "Summary (read-only)";
export const INSTRUCTIONS_SHEET = "Instructions";

export type ReadResult = { ok: true; rows: string[][]; sheetName: string } | { ok: false; error: string };

/** Walks the zip's central directory (no decompression) to refuse macros and zip bombs before any parser sees the file. */
function inspectZip(buf: Uint8Array): { ok: true } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "That is not a valid .xlsx workbook." };
  if (buf.length < 22 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 3 || buf[3] !== 4) return bad;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return bad;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) return bad;
  if (count > IMPORT_LIMITS.maxEntries) return { ok: false, error: "That workbook has too many internal parts to be a normal spreadsheet." };
  const names: string[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) return bad;
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    total += size;
    if (size === 0xffffffff || total > IMPORT_LIMITS.maxUncompressedBytes) return { ok: false, error: "That workbook expands to an unreasonable size and was not opened." };
    names.push(new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  if (!names.includes("[Content_Types].xml") || !names.includes("xl/workbook.xml")) return bad;
  if (names.some((x) => /vbaProject|macrosheets\/|xl\/embeddings\/|\.bin$/i.test(x))) return { ok: false, error: "Workbooks with macros or embedded objects are not accepted. Save a plain .xlsx copy and upload that." };
  return { ok: true };
}

/** Plain text of one cell. Formulas give their stored result (never evaluated); links give their text; control characters are removed. */
export function cellText(value: unknown): string {
  let v: unknown = value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ("richText" in o && Array.isArray(o.richText)) v = o.richText.map((r) => String((r as { text?: unknown }).text ?? "")).join("");
    else if ("formula" in o || "sharedFormula" in o) v = "result" in o ? o.result : "";
    else if ("hyperlink" in o) v = o.text;
    else if ("error" in o) v = "";
    else v = "";
    if (v && typeof v === "object" && !(v instanceof Date)) return cellText(v);
  }
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, IMPORT_LIMITS.maxCellChars);
}

/** Validates the upload and returns the data sheet as rows of text (index 0 = sheet row 1). Summary and Instructions sheets are never read. */
export async function readImportSheet(bytes: Uint8Array, fileName: string): Promise<ReadResult> {
  if (!/\.xlsx$/i.test(fileName)) return { ok: false, error: "Only .xlsx files are accepted." };
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > IMPORT_LIMITS.maxBytes) return { ok: false, error: `The file is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB. Split it into smaller files.` };
  const zip = inspectZip(bytes);
  if (!zip.ok) return zip;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return { ok: false, error: "That file could not be read as an Excel workbook." };
  }
  const skip = (n: string) => n === SUMMARY_SHEET || n === INSTRUCTIONS_SHEET;
  const ws = wb.worksheets.find((s) => s.name === ORGANISATIONS_SHEET) ?? wb.worksheets.find((s) => !skip(s.name));
  if (!ws) return { ok: false, error: "The workbook has no data sheet." };
  const rows: string[][] = [];
  let nonEmpty = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > IMPORT_LIMITS.maxRows + 50 || nonEmpty > IMPORT_LIMITS.maxRows + 50) return;
    const cells: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => { if (col <= IMPORT_LIMITS.maxColumns) cells[col - 1] = cellText(cell.value); });
    for (let i = 0; i < cells.length; i++) cells[i] ??= "";
    while (rows.length < rowNumber - 1) rows.push([]);
    rows[rowNumber - 1] = cells;
    if (cells.some((c) => c !== "")) nonEmpty++;
  });
  return { ok: true, rows, sheetName: ws.name };
}

/** Spreadsheet formula injection: a text cell that starts with = + - @ (or a tab / carriage return) is stored with a leading single quote. */
export function neutraliseCell(value: string | number | null | undefined): string | number {
  if (value == null) return "";
  if (typeof value === "number") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
/** Undoes neutraliseCell on the way back in, so an exported workbook re-imports unchanged. */
export const unneutralise = (v: string): string => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

const EXAMPLE_PREFIX = "EXAMPLE ONLY";
export const isExampleName = (name: string) => name.toUpperCase().startsWith(EXAMPLE_PREFIX);

function styleHeader(ws: ExcelJS.Worksheet, widths: number[]) {
  const h = ws.getRow(1);
  h.font = { bold: true };
  h.alignment = { vertical: "middle", wrapText: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

/** The downloadable template: headers, three clearly fictional example rows, and an Instructions sheet. Generated at request time; no file is stored. */
export async function buildTemplateWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ENGINIOUS OS";
  const ws = wb.addWorksheet(ORGANISATIONS_SHEET);
  ws.addRow([...TEMPLATE_HEADERS]);
  ws.addRow([`${EXAMPLE_PREFIX} - Northwind Events (fictional)`, "United Arab Emirates", "Agency", "northwind.example", "Sample Person One", "Producer", "person.one@northwind.example", "+971 50 000 0001", "Exhibition: Sample Expo", "Delete the three example rows before uploading.", ""]);
  ws.addRow([`${EXAMPLE_PREFIX} - Northwind Events (fictional)`, "United Arab Emirates", "Agency", "northwind.example", "Sample Person Two", "Account manager", "person.two@northwind.example", "", "", "", ""]);
  ws.addRow([`${EXAMPLE_PREFIX} - Contoso Direct (fictional)`, "Saudi Arabia", "Direct client", "", "", "", "", "", "Referral", "", "colleague@your-company.example"]);
  styleHeader(ws, [34, 20, 20, 24, 22, 20, 30, 18, 26, 34, 32]);
  for (let r = 2; r <= 500; r++) ws.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Agency,Direct client,End client,Technology Company"'], showErrorMessage: false };
  const help = wb.addWorksheet(INSTRUCTIONS_SHEET);
  const lines = [
    "How to use this template",
    "1. Fill the Organisations sheet, one row per contact. Several rows with the same Organisation name become ONE organisation with several contacts.",
    "2. Only Organisation name is required. Leave any other cell empty if you do not know it.",
    "3. Organisation type: Agency, Direct client, End client or Technology Company (more than one: separate with a comma).",
    "4. Country: a country name or two-letter code. A country that is not recognised is kept in the notes and flagged for review.",
    "5. Lead source / exhibition: a source (Agency call, LinkedIn, Direct client, WhatsApp, Instagram, Website, Referral, Exhibition, Other) or the name of the show.",
    "6. Account owner work email (optional): must be the work email of a colleague with Sales access to the company you import into. It is applied only when it can be verified; otherwise the account stays Unassigned and the row is flagged. No user account is ever created from this file.",
    "7. Delete the three EXAMPLE ONLY rows. Rows that start with EXAMPLE ONLY are ignored.",
    "8. Upload the file on Clients & Agencies, Import. You see a preview first; nothing is saved until you confirm.",
    "9. Importing only fills EMPTY fields and adds new contacts. Anything that differs from what is already recorded is shown to you and is never overwritten. Importing the same file again changes nothing.",
    "Limits: .xlsx only, no macros, 4 MB, 2000 rows. Formulas are never run; only the values in the cells are read.",
  ];
  lines.forEach((l, i) => { help.addRow([l]); if (i === 0) help.getRow(1).font = { bold: true, size: 14 }; });
  help.getColumn(1).width = 140;
  help.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export interface SheetTable { name: string; headers: readonly string[]; rows: readonly (string | number | null)[][]; widths?: readonly number[]; footer?: readonly string[] }

/** A workbook from tables; every text cell is neutralised against formula injection. */
export async function buildWorkbook(tables: readonly SheetTable[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ENGINIOUS OS";
  for (const t of tables) {
    const ws = wb.addWorksheet(t.name);
    ws.addRow(t.headers.map((h) => neutraliseCell(h)));
    for (const r of t.rows) ws.addRow(r.map((c) => neutraliseCell(c)));
    if (t.footer?.length) { ws.addRow([]); for (const f of t.footer) ws.addRow([neutraliseCell(f)]); }
    styleHeader(ws, t.widths ? [...t.widths] : t.headers.map(() => 22));
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
