import ExcelJS from "exceljs";
import { INSTRUCTIONS_SHEET } from "../../clients-agencies/import/xlsx";
import { EVENT_TEMPLATE_HEADERS } from "./parse";

export const EVENTS_SHEET = "Events";

/** The blank template: the six headers (one row per edition), date columns formatted YYYY-MM-DD, and an Instructions sheet. Generated at request time; nothing is stored. */
export async function buildEventsTemplate(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ENGINIOUS OS";
  const ws = wb.addWorksheet(EVENTS_SHEET);
  ws.addRow([...EVENT_TEMPLATE_HEADERS]);
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: "middle", wrapText: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  [34, 22, 18, 30, 14, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getColumn(5).numFmt = "yyyy-mm-dd";
  ws.getColumn(6).numFmt = "yyyy-mm-dd";
  const help = wb.addWorksheet(INSTRUCTIONS_SHEET);
  const lines = [
    "How to use this template",
    "1. Fill the Events sheet: ONE ROW PER EDITION. Several rows with the same Event name become ONE event with several editions.",
    "2. Required: Event name, Country, Start date, End date. City and Venue are optional.",
    "3. Country: a country name (United Arab Emirates) or a two-letter code (AE). Dates: YYYY-MM-DD (2026-10-12) or a normal Excel date cell. End date cannot be before Start date.",
    "4. Upload the file on Events & Exhibitions, Import events. Excel .xlsx or .csv. You see a preview first; nothing is saved until you confirm.",
    "5. The preview marks each row: new event, new edition of an existing event, already present (skipped), or needs correction. If any row needs correction, nothing is saved until the file is corrected.",
    "6. Existing events and editions are never changed: a row whose dates differ from a recorded edition is flagged, never overwritten. Archived events and editions are never reopened. Importing the same file again adds nothing.",
    "7. This imports events and editions only. It does not import observations, agencies or enquiries, and it never links an enquiry.",
    "Limits: .xlsx (no macros) or .csv, 4 MB, 2000 rows. Formulas are never run; only the values in the cells are read.",
  ];
  lines.forEach((l, i) => { help.addRow([l]); if (i === 0) help.getRow(1).font = { bold: true, size: 14 }; });
  help.getColumn(1).width = 140;
  help.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
