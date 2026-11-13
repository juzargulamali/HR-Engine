import ExcelJS from "exceljs";
import { INSTRUCTIONS_SHEET, neutraliseCell } from "@/lib/crm/clients-agencies/import/xlsx";
import { DP_CURRENT_SECTIONS, DP_SECTION_SHEET_NAMES, itemProgress, lineProgress, type DeliveryPlan } from "../model";

/**
 * The Delivery Plan workbook: the template and the export have the same shape, so export, edit, import round-trips. Generated at request time; nothing is stored.
 * Deliverables is the simple sheet (a supply-and-install job needs only this one); Breakdown is optional. Every text cell is neutralised against spreadsheet formula
 * injection with the same helper as the Clients & Agencies export. The export carries only what `proj_dp_plan` returned for this person, plus names: no price, no chat,
 * no file contents, and never a URL.
 */
export const DELIVERABLES_SHEET = "Deliverables";
export const BREAKDOWN_SHEET = "Breakdown";
export const DP_EXCEL_LIMITS = { maxItems: 1000, maxLines: 2000 } as const;
export const EXAMPLE_PREFIX = "EXAMPLE";

export const DELIVERABLE_HEADERS = ["Deliverable ID", "Zone", "Deliverable", "Specifications", "Accountable owner", "Needed by"] as const;
export const BREAKDOWN_HEADERS = ["Line ID", "Deliverable ID", "Zone", "Deliverable", "Section", "Description", "Quantity", "Stock item", "Assigned to", "Needed by", "Notes"] as const;
export const REFERENCE_IMAGE_HEADER = "Reference image";
export const READ_ONLY_HEADERS = ["Released (read-only)", "Progress (read-only)"] as const;

export const DP_INSTRUCTIONS = [
  "How to use this workbook",
  "1. Deliverables sheet: one row per deliverable (what the client gets, in which zone). A simple supply-and-install job needs only this sheet.",
  "2. Breakdown sheet is optional. Use it only for jobs that need it: one row per line of Hardware, Content, Apps, Engineering or Site work under a deliverable. Plans made earlier may also carry Programming, Installation or Testing lines, which are still read.",
  "3. A Breakdown row names its deliverable by Deliverable ID, or, for a deliverable that is new in this workbook, by the same Zone and Deliverable as its row on the Deliverables sheet.",
  "4. Deliverable ID (D001) and Line ID (L0001) identify the same row even if its name changes. Never edit an ID. Leave the ID empty for a new row.",
  "5. Blank cells and missing rows never delete anything: a blank cell leaves the value as it is, and a row that is not in the workbook is left alone.",
  "6. Accountable owner and Assigned to: the name of a member of the project. Stock item (Hardware lines only): the name of an inventory item. A name that is not found, or fits more than one, is shown to you to choose before anything is saved.",
  "7. Needed by: a date, yyyy-mm-dd (2026-11-30) or a normal Excel date cell. Quantity: a number more than zero.",
  "8. Progress, approvals, stock states, reservations and handover completion are never read from the workbook. The columns marked (read-only) and Reference image are filled on export and ignored on import.",
  "9. Rows that were already released are not changed by an import: your changes become proposals for the Project Manager to approve or reject.",
  "10. Equipment that is already with the warehouse is changed on the Equipment tab, not here.",
  "11. Importing does not release anything. Tasks and the equipment request are created only by Release on the Delivery plan.",
  "12. Delete the EXAMPLE rows. Rows whose Zone starts with EXAMPLE are ignored.",
  "13. Upload the workbook on the Delivery plan, Import Excel. You see a preview first; nothing is saved until you confirm.",
  "Limits: .xlsx only, no macros, 4 MB, 1000 deliverable rows and 2000 breakdown rows. Formulas are never run; only the values in the cells are read.",
] as const;

type Cell = string | number | Date | null;

/** yyyy-mm-dd as a real date cell (UTC midnight), so Excel shows and sorts it as a date; anything else stays text. */
const dateCell = (iso: string | null): Cell => {
  if (!iso) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : iso;
};
// An empty value writes no cell at all (not an empty text cell).
const put = (v: Cell) => (v instanceof Date ? v : v == null || v === "" ? null : neutraliseCell(v));

function addSheet(wb: ExcelJS.Workbook, name: string, headers: readonly string[], rows: readonly Cell[][], widths: readonly number[], dateColumn: number) {
  const ws = wb.addWorksheet(name);
  ws.addRow(headers.map((h) => neutraliseCell(h)));
  for (const r of rows) ws.addRow(r.map(put));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: "middle", wrapText: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getColumn(dateColumn).numFmt = "yyyy-mm-dd";
  // The read-only columns are greyed, so it is plain that editing them does nothing.
  headers.forEach((h, i) => {
    if (!h.includes("(read-only)") && h !== REFERENCE_IMAGE_HEADER) return;
    for (let r = 1; r <= rows.length + 1; r++) ws.getCell(r, i + 1).font = { ...(r === 1 ? { bold: true } : {}), italic: true, color: { argb: "FF777777" } };
  });
  return ws;
}

function addInstructions(wb: ExcelJS.Workbook) {
  const help = wb.addWorksheet(INSTRUCTIONS_SHEET);
  DP_INSTRUCTIONS.forEach((l, i) => { help.addRow([l]); if (i === 0) help.getRow(1).font = { bold: true, size: 14 }; });
  help.getColumn(1).width = 140;
  help.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; });
}

function sectionPicker(ws: ExcelJS.Worksheet, lastRow: number) {
  const list = `"${DP_CURRENT_SECTIONS.map((s) => DP_SECTION_SHEET_NAMES[s]).join(",")}"`;
  for (let r = 2; r <= lastRow; r++) ws.getCell(r, 5).dataValidation = { type: "list", allowBlank: true, formulae: [list], showErrorMessage: false };
}

const ITEM_WIDTHS = [14, 22, 36, 48, 24, 14, 26, 18, 40];
const LINE_WIDTHS = [12, 14, 22, 36, 16, 40, 10, 30, 24, 14, 36, 18, 40];

/** The blank template: the three sheets, with two clearly marked, fictional example rows on each data sheet (ignored on import). */
export async function buildDeliveryPlanTemplate(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ENGINIOUS OS";
  const zone = `${EXAMPLE_PREFIX} Entrance (delete this row)`;
  addSheet(wb, DELIVERABLES_SHEET, DELIVERABLE_HEADERS, [
    ["", zone, "Interactive welcome wall (fictional)", "3 m x 2 m LED wall with a touch overlay", "", dateCell("2027-03-01")],
    ["", `${EXAMPLE_PREFIX} Main hall (delete this row)`, "Projection table (fictional)", "Round table, 1.6 m, top-down projection", "", dateCell("2027-03-05")],
  ], ITEM_WIDTHS.slice(0, DELIVERABLE_HEADERS.length), 6);
  const lines = addSheet(wb, BREAKDOWN_SHEET, BREAKDOWN_HEADERS, [
    ["", "", zone, "Interactive welcome wall (fictional)", "Hardware", "LED panels", 24, "", "", dateCell("2027-02-20"), "Stock item: the name of an inventory item"],
    ["", "", zone, "Interactive welcome wall (fictional)", "Content", "Welcome animation", null, "", "", dateCell("2027-02-25"), ""],
  ], LINE_WIDTHS.slice(0, BREAKDOWN_HEADERS.length), 10);
  sectionPicker(lines, 500);
  addInstructions(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export interface ExportPerson { id: string; name: string }

/**
 * The project's current plan in the template's shape, with the read-only columns filled. `people` are the project's members (names for owner and assignee);
 * `fileLabels` names the reference images by file id and `stockNames` the stock items by inventory item id. A name that is not supplied is left blank, and a blank
 * cell is never read back as a change.
 */
export async function buildDeliveryPlanExport(
  plan: Pick<DeliveryPlan, "items">, people: readonly ExportPerson[], fileLabels: Readonly<Record<string, string>> = {}, stockNames: Readonly<Record<string, string>> = {},
): Promise<Uint8Array> {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const person = (id: string | null, fallback: string | null) => (id ? names.get(id) ?? fallback ?? "" : "");
  const items: Cell[][] = [];
  const lines: Cell[][] = [];
  for (const it of plan.items) {
    items.push([
      it.key, it.zone, it.title, it.specs ?? "", person(it.owner_id, it.owner_name), dateCell(it.needed_by),
      it.image_file_id ? fileLabels[it.image_file_id] ?? "Image attached" : "", it.released_at ? "Yes" : "No", itemProgress(it).text,
    ]);
    for (const l of it.lines) {
      lines.push([
        l.key, it.key, it.zone, it.title, DP_SECTION_SHEET_NAMES[l.section], l.description, l.qty === null ? null : Number(l.qty),
        l.inv_item_id ? stockNames[l.inv_item_id] ?? "" : "", person(l.assignee_id, l.assignee_name), dateCell(l.needed_by), l.notes ?? "",
        l.released_at ? "Yes" : "No", lineProgress(l).text,
      ]);
    }
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "ENGINIOUS OS";
  addSheet(wb, DELIVERABLES_SHEET, [...DELIVERABLE_HEADERS, REFERENCE_IMAGE_HEADER, ...READ_ONLY_HEADERS], items, ITEM_WIDTHS, 6);
  sectionPicker(addSheet(wb, BREAKDOWN_SHEET, [...BREAKDOWN_HEADERS, ...READ_ONLY_HEADERS], lines, LINE_WIDTHS, 10), lines.length + 300);
  addInstructions(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
