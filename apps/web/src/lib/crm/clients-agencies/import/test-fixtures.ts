import ExcelJS from "exceljs";
import { buildPlan, type ImportPlan, type PlanContext } from "./plan";
import { parseRows, type ParsedFile } from "./parse";
import { readImportSheet } from "./xlsx";

/** Fictional workbooks for tests, generated in memory. No real record and no file on disk. */

export async function makeWorkbook(sheets: { name: string; rows: (string | number | null | { formula: string; result: string | number })[][] }[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const r of s.rows) {
      const row = ws.addRow([]);
      r.forEach((v, i) => { if (v !== null && v !== "") row.getCell(i + 1).value = v as ExcelJS.CellValue; });
      if (r.length === 0) row.values = [];
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export const TEMPLATE_ROW_HEADERS = ["Organisation name", "Country", "Organisation type", "Website", "Contact name", "Contact title", "Contact email", "Contact phone", "Lead source / exhibition", "Notes", "Account owner work email"];

/** The shape of the existing workbook: an empty first row, a header row, an unlabelled serial-number column, then the three data headers. */
export async function legacyWorkbook(opts: { serialHeader?: string } = {}): Promise<{ bytes: Uint8Array; expected: { source: number; unnamed: number; duplicates: number; candidates: number; agency: number; direct: number; technology: number } }> {
  const rows: (string | number | null)[][] = [[], [null, opts.serialHeader ?? null, "Client name", "location", "Type"]];
  const countries = ["UAE", "United Kingdom", "Saudi Arabia", "Qatar", "Germany", "India"];
  const names: string[] = [];
  const add = (type: string, n: number, prefix: string) => { for (let i = 0; i < n; i++) names.push(`${prefix} ${String(names.length + 1).padStart(3, "0")}|${type}`); };
  add("Agency", 48, "Fixture Agency"); add("Direct client", 4, "Fixture Direct"); add("Technology Company", 6, "Fixture Tech");
  names.forEach((x, i) => { const [name, type] = x.split("|"); rows.push([null, i + 1, name!, countries[i % countries.length]!, type!]); });
  // Six repeats (different case and punctuation), one unnamed row.
  for (let i = 0; i < 6; i++) { const [name, type] = names[i * 9]!.split("|"); rows.push([null, rows.length, name!.toUpperCase() + ".", "UAE", type!]); }
  rows.push([null, rows.length, null, "UAE", "Agency"]);
  return { bytes: await makeWorkbook([{ name: "Sheet1", rows }]), expected: { source: 65, unnamed: 1, duplicates: 6, candidates: 58, agency: 48, direct: 4, technology: 6 } };
}

export async function parseBytes(bytes: Uint8Array): Promise<ParsedFile> {
  const read = await readImportSheet(bytes, "fixture.xlsx");
  if (!read.ok) throw new Error(read.error);
  const parsed = parseRows(read.rows);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.file;
}

export const planFor = (file: ParsedFile, ctx: Partial<PlanContext> = {}): ImportPlan =>
  buildPlan(file, { directory: [], staff: [], companyId: "co-1", canAssign: true, ...ctx });
