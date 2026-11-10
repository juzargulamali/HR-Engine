import { normaliseCountry, normaliseName } from "../../clients-agencies/normalise";
import { IMPORT_LIMITS, readImportSheet, unneutralise } from "../../clients-agencies/import/xlsx";

/**
 * Spreadsheet or CSV rows to calendar rows (event, country, city, venue, start, end). Pure: nothing here touches the database. The .xlsx file is opened with the same
 * safety checks as the Clients & Agencies import (no macros, no zip bombs, formulas never run, cell values only). Everything read is untrusted text.
 *
 * The rows this returns have only been checked for SHAPE (required cells, a recognised country, real dates, a sensible range). Whether a row is new, already present or
 * in conflict is decided by the database function crm_import_events, once, for both the preview and the save.
 */

export const EVENT_TEMPLATE_HEADERS = ["Event name", "Country", "City", "Venue", "Start date", "End date"] as const;
export type EventField = "name" | "country" | "city" | "venue" | "start" | "end";

const alias = (field: EventField, ...names: string[]) => names.map((n) => [normaliseName(n), field] as const);
const HEADER_FIELDS = new Map<string, EventField>([
  ...alias("name", "Event name", "Event", "Exhibition", "Exhibition name", "Show", "Name"),
  ...alias("country", "Country"),
  ...alias("city", "City"),
  ...alias("venue", "Venue", "Location"),
  ...alias("start", "Start date", "Start", "Starts", "From"),
  ...alias("end", "End date", "End", "Ends", "To"),
]);
const REQUIRED: { field: EventField; label: string }[] = [
  { field: "name", label: "Event name" }, { field: "country", label: "Country" }, { field: "start", label: "Start date" }, { field: "end", label: "End date" },
];

export interface ImportRow { row: number; name: string; country: string; city: string; venue: string; start: string; end: string }
export interface RejectedRow { row: number; reason: string; name: string; start: string; end: string }
export interface ParsedEvents { rows: ImportRow[]; rejected: RejectedRow[]; ignoredColumns: string[]; sourceRows: number }
export type ParseOutcome = { ok: true; file: ParsedEvents } | { ok: false; error: string };

/** A real calendar date written YYYY-MM-DD, or null. */
export function isoDate(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? text : null;
}

/** Dates arrive as native Excel dates (already YYYY-MM-DD), as typed YYYY-MM-DD text, or as a bare Excel serial number (a date cell whose format was lost). */
export function parseDateCell(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const iso = isoDate(t.slice(0, 10).length === 10 && /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(t) ? t.slice(0, 10) : t);
  if (iso) return iso;
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const n = Math.floor(Number(t));
    if (n >= 30000 && n <= 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

/** RFC 4180 CSV: quoted cells, doubled quotes, newlines inside quotes, a leading BOM; the delimiter (comma, semicolon or tab) is read from the first line. */
export function parseCsv(textIn: string): string[][] {
  const text = textIn.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, IMPORT_LIMITS.maxCellChars)));
}

async function readTable(bytes: Uint8Array, fileName: string): Promise<{ ok: true; rows: string[][] } | { ok: false; error: string }> {
  if (/\.csv$/i.test(fileName)) {
    if (bytes.length === 0) return { ok: false, error: "The file is empty." };
    if (bytes.length > IMPORT_LIMITS.maxBytes) return { ok: false, error: `The file is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB. Split it into smaller files.` };
    if (bytes.includes(0)) return { ok: false, error: "That does not look like a CSV text file." };
    return { ok: true, rows: parseCsv(new TextDecoder("utf-8").decode(bytes)) };
  }
  if (!/\.xlsx$/i.test(fileName)) return { ok: false, error: "Upload an Excel .xlsx file or a .csv file." };
  const read = await readImportSheet(bytes, fileName);
  return read.ok ? { ok: true, rows: read.rows } : read;
}

export async function parseEventsFile(bytes: Uint8Array, fileName: string): Promise<ParseOutcome> {
  const table = await readTable(bytes, fileName);
  if (!table.ok) return table;
  const rows = table.rows;
  // the header is the first of the first ten rows that names the event column
  let headerIndex = -1; const columns = new Map<EventField, number>();
  for (let i = 0; i < Math.min(rows.length, 10) && headerIndex < 0; i++) {
    const found = new Map<EventField, number>();
    (rows[i] ?? []).forEach((h, c) => { const f = HEADER_FIELDS.get(normaliseName(unneutralise(h ?? ""))); if (f && !found.has(f)) found.set(f, c); });
    if (found.has("name")) { headerIndex = i; for (const [f, c] of found) columns.set(f, c); }
  }
  if (headerIndex < 0) return { ok: false, error: "No header row was found. The first row must name the columns: Event name, Country, City, Venue, Start date, End date. Download the template to start from." };
  const missing = REQUIRED.filter((r) => !columns.has(r.field)).map((r) => r.label);
  if (missing.length) return { ok: false, error: `The file has no ${missing.join(", ")} column. Required columns: Event name, Country, Start date, End date.` };
  const header = rows[headerIndex] ?? [];
  const used = new Set(columns.values());
  const ignoredColumns = header.map((h, c) => (!used.has(c) && h ? h : "")).filter(Boolean);

  const dataRows = rows.slice(headerIndex + 1);
  if (dataRows.filter((r) => r.some((c) => c && c !== "")).length > IMPORT_LIMITS.maxRows) return { ok: false, error: `The file has more than ${IMPORT_LIMITS.maxRows} rows. Split it into smaller files.` };

  const out: ImportRow[] = []; const rejected: RejectedRow[] = []; let sourceRows = 0;
  dataRows.forEach((cells, k) => {
    const rowNumber = headerIndex + 2 + k;                                  // the row number the person sees in their sheet (header row 1)
    const cell = (f: EventField) => unneutralise(cells[columns.get(f) ?? -1] ?? "").trim();
    if (!cells.some((c) => c && c.trim() !== "")) return;                    // blank rows are ignored
    sourceRows++;
    const name = cell("name"); const countryText = cell("country"); const startText = cell("start"); const endText = cell("end");
    const reasons: string[] = [];
    if (!name) reasons.push("Event name is required");
    else if (name.length > 200) reasons.push("Event name is longer than 200 characters");
    else if (!/[A-Za-z0-9]/.test(name)) reasons.push("Event name needs letters or digits");
    const country = normaliseCountry(countryText);
    if (!countryText) reasons.push("Country is required");
    else if (!country) reasons.push(`Country “${countryText}” is not recognised: use a country name or a two-letter code such as AE`);
    const start = parseDateCell(startText); const end = parseDateCell(endText);
    if (!startText) reasons.push("Start date is required");
    else if (!start) reasons.push(`Start date “${startText}” is not a valid date: use YYYY-MM-DD, for example 2026-10-12`);
    if (!endText) reasons.push("End date is required");
    else if (!end) reasons.push(`End date “${endText}” is not a valid date: use YYYY-MM-DD, for example 2026-10-16`);
    if (start && end && end < start) reasons.push("End date is before the start date");
    if (start && end && (Number(start.slice(0, 4)) < 2000 || Number(end.slice(0, 4)) > 2100)) reasons.push("Dates must be between the years 2000 and 2100");
    const city = cell("city"); const venue = cell("venue");
    if (city.length > 100) reasons.push("City is longer than 100 characters");
    if (venue.length > 200) reasons.push("Venue is longer than 200 characters");
    if (reasons.length) { rejected.push({ row: rowNumber, reason: reasons.join("; "), name, start: startText, end: endText }); return; }
    out.push({ row: rowNumber, name, country: country!, city, venue, start: start!, end: end! });
  });
  return { ok: true, file: { rows: out, rejected, ignoredColumns, sourceRows } };
}
