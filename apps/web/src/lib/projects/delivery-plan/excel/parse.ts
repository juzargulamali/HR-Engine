import ExcelJS from "exceljs";
import { IMPORT_LIMITS, cellText, readImportSheet, unneutralise } from "@/lib/crm/clients-agencies/import/xlsx";
import { parseDateCell } from "@/lib/crm/events/import/parse";
import { BREAKDOWN_SHEET, DELIVERABLES_SHEET, DP_EXCEL_LIMITS, EXAMPLE_PREFIX } from "./workbook";

/**
 * The uploaded workbook to rows of text, with the sheet and the row number the person sees. Nothing here touches the database. The file is first put through the same
 * checks as the Clients & Agencies import (.xlsx only, 4 MB, no macros, no zip bombs); cells are read with the same reader (values only: a formula gives its stored
 * result as text and is never run). Everything read is untrusted text. The read-only columns, Reference image and the Instructions sheet are never read.
 */
export type DpSheet = typeof DELIVERABLES_SHEET | typeof BREAKDOWN_SHEET;
export type ItemField = "id" | "zone" | "title" | "specs" | "owner" | "neededBy";
export type LineField = "id" | "itemId" | "zone" | "title" | "section" | "description" | "qty" | "stockItem" | "assignee" | "neededBy" | "notes";

type RowOf<F extends string> = Record<F, string> & {
  row: number;
  /** The Needed by cell as yyyy-mm-dd; null when the cell is blank or is not a date (the planner reports the second). */
  neededByIso: string | null;
  /** Cells too long to be read whole (the reader stops at 2000 characters). They are treated as blank, and the preview says so. */
  tooLong: F[];
};
export type ParsedItemRow = RowOf<ItemField>;
export type ParsedLineRow = RowOf<LineField>;
export interface ParsedPlanWorkbook { items: ParsedItemRow[]; lines: ParsedLineRow[]; hasDeliverables: boolean; hasBreakdown: boolean; examplesSkipped: number }
export type ParsePlanOutcome = { ok: true; file: ParsedPlanWorkbook } | { ok: false; error: string };

const head = (s: string) => unneutralise(s).trim().replace(/\s+/g, " ").toLowerCase();
const columns = <F extends string>(pairs: [F, string[]][]) => new Map(pairs.flatMap(([f, names]) => names.map((n) => [head(n), f] as const)));

const ITEM_COLUMNS = columns<ItemField>([
  ["id", ["Deliverable ID"]], ["zone", ["Zone"]], ["title", ["Deliverable", "Deliverable name"]], ["specs", ["Specifications", "Specification", "Specs"]],
  ["owner", ["Accountable owner", "Owner"]], ["neededBy", ["Needed by"]],
]);
const LINE_COLUMNS = columns<LineField>([
  ["id", ["Line ID"]], ["itemId", ["Deliverable ID"]], ["zone", ["Zone"]], ["title", ["Deliverable", "Deliverable name"]], ["section", ["Section"]],
  ["description", ["Description"]], ["qty", ["Quantity", "Qty"]], ["stockItem", ["Stock item"]], ["assignee", ["Assigned to"]], ["neededBy", ["Needed by"]], ["notes", ["Notes"]],
]);
const ITEM_FIELDS: ItemField[] = ["id", "zone", "title", "specs", "owner", "neededBy"];
const LINE_FIELDS: LineField[] = ["id", "itemId", "zone", "title", "section", "description", "qty", "stockItem", "assignee", "neededBy", "notes"];

type SheetRead<F extends string> = { ok: true; rows: RowOf<F>[]; examples: number } | { ok: false; error: string };

function readRows<F extends string>(ws: ExcelJS.Worksheet, known: ReadonlyMap<string, F>, fields: readonly F[], anchor: readonly F[], max: number, what: string): SheetRead<F> {
  // Cell text by row and column, values only.
  const grid = new Map<number, string[]>();
  let last = 0;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (grid.size > max + 60) return;
    const cells: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => { if (col <= IMPORT_LIMITS.maxColumns) cells[col - 1] = cellText(cell.value); });
    if (cells.some((c) => c)) { grid.set(n, cells); last = Math.max(last, n); }
  });
  if (grid.size === 0) return { ok: true, rows: [], examples: 0 };                           // an empty sheet is simply no rows
  // The header is the first of the first ten rows that names the anchor columns.
  let headerRow = 0; const at = new Map<F, number>();
  for (let n = 1; n <= 10 && !headerRow; n++) {
    const found = new Map<F, number>();
    (grid.get(n) ?? []).forEach((h, c) => { const f = known.get(head(h ?? "")); if (f && !found.has(f)) found.set(f, c); });
    if (anchor.every((f) => found.has(f))) { headerRow = n; for (const [f, c] of found) at.set(f, c); }
  }
  if (!headerRow) return { ok: false, error: `The ${ws.name} sheet has no header row. Download the template to start from.` };
  const rows: RowOf<F>[] = []; let examples = 0;
  for (let n = headerRow + 1; n <= last; n++) {
    const cells = grid.get(n);
    if (!cells) continue;
    const tooLong: F[] = [];
    const r = { row: n, tooLong, neededByIso: null } as RowOf<F>;
    for (const f of fields) {
      const col = at.get(f);
      let text = col === undefined ? "" : unneutralise(cells[col] ?? "").trim();
      if (text.length >= IMPORT_LIMITS.maxCellChars) { tooLong.push(f); text = ""; }
      (r as Record<F, string>)[f] = text;
    }
    if (fields.every((f) => !r[f]) && tooLong.length === 0) continue;                       // blank rows (and rows with only read-only cells) are ignored
    if ("zone" in r && (r as unknown as { zone: string }).zone.toUpperCase().startsWith(EXAMPLE_PREFIX)) { examples++; continue; }
    const date = (r as unknown as { neededBy: string }).neededBy;
    r.neededByIso = date ? parseDateCell(date) : null;
    rows.push(r);
    if (rows.length > max) return { ok: false, error: `The ${ws.name} sheet has more than ${max} ${what}. Split the workbook into smaller files.` };
  }
  return { ok: true, rows, examples };
}

export async function parseDeliveryPlanWorkbook(bytes: Uint8Array, fileName: string): Promise<ParsePlanOutcome> {
  // The shared checks first: extension, size, macros, embedded objects, zip bombs, and that it opens as a workbook.
  const checked = await readImportSheet(bytes, fileName);
  if (!checked.ok) return checked;
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes as unknown as ArrayBuffer); } catch { return { ok: false, error: "That file could not be read as an Excel workbook." }; }
  const sheet = (name: string) => wb.worksheets.find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
  const itemsSheet = sheet(DELIVERABLES_SHEET); const linesSheet = sheet(BREAKDOWN_SHEET);
  if (!itemsSheet && !linesSheet) return { ok: false, error: "The workbook has no Deliverables sheet. Download the template to start from." };
  const items = itemsSheet ? readRows(itemsSheet, ITEM_COLUMNS, ITEM_FIELDS, ["title"], DP_EXCEL_LIMITS.maxItems, "deliverable rows") : null;
  if (items && !items.ok) return items;
  const lines = linesSheet ? readRows(linesSheet, LINE_COLUMNS, LINE_FIELDS, ["section", "description"], DP_EXCEL_LIMITS.maxLines, "breakdown rows") : null;
  if (lines && !lines.ok) return lines;
  return {
    ok: true,
    file: { items: items?.rows ?? [], lines: lines?.rows ?? [], hasDeliverables: !!itemsSheet, hasBreakdown: !!linesSheet, examplesSkipped: (items?.examples ?? 0) + (lines?.examples ?? 0) },
  };
}
