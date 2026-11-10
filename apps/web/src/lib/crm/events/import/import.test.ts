import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { isoDate, parseCsv, parseDateCell, parseEventsFile } from "./parse";
import { runEventsImport, type ImportDeps } from "./service";
import { buildEventsTemplate } from "./template";

const enc = (s: string) => new TextEncoder().encode(s);
const HEAD = "Event name,Country,City,Venue,Start date,End date";

async function workbook(rows: (string | Date | number | null)[][], headers: string[] = ["Event name", "Country", "City", "Venue", "Start date", "End date"]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Events");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("dates", () => {
  it("accepts YYYY-MM-DD, a date with a time, and an Excel serial; refuses anything else", () => {
    expect(isoDate("2026-10-12")).toBe("2026-10-12");
    expect(isoDate("2026-02-30")).toBeNull();
    expect(parseDateCell("2026-10-12")).toBe("2026-10-12");
    expect(parseDateCell("2026-10-12T00:00:00.000Z")).toBe("2026-10-12");
    expect(parseDateCell("46307")).toBe("2026-10-12");
    for (const bad of ["12/10/2026", "October 12", "2026-13-01", "", "abc"]) expect(parseDateCell(bad)).toBeNull();
  });
});

describe("csv", () => {
  it("reads quoted cells, doubled quotes, a BOM, semicolons and CRLF", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
});

describe("parsing the file", () => {
  it("reads a CSV into rows with the sheet row numbers, and rejects bad rows with specific reasons", async () => {
    const csv = [HEAD, "Fictional Expo,United Arab Emirates,Dubai,Hall 1,2026-10-12,2026-10-16", "Fictional Expo,AE,Dubai,,2027-10-11,2027-10-15", ",AE,,,2026-01-01,2026-01-02",
      "Bad Date,AE,,,12/10/2026,2026-10-16", "Bad Range,AE,,,2026-10-16,2026-10-12", "No Country,Narnia,,,2026-01-01,2026-01-02", "", ",,,,,"].join("\n");
    const r = await parseEventsFile(enc(csv), "calendar.csv");
    if (!r.ok) throw new Error(r.error);
    expect(r.file.rows.map((x) => [x.row, x.name, x.country, x.start, x.end])).toEqual([[2, "Fictional Expo", "AE", "2026-10-12", "2026-10-16"], [3, "Fictional Expo", "AE", "2027-10-11", "2027-10-15"]]);
    const why = Object.fromEntries(r.file.rejected.map((x) => [x.row, x.reason]));
    expect(why[4]).toMatch(/Event name is required/);
    expect(why[5]).toMatch(/Start date “12\/10\/2026” is not a valid date/);
    expect(why[6]).toMatch(/End date is before the start date/);
    expect(why[7]).toMatch(/Country “Narnia” is not recognised/);
    expect(r.file.sourceRows).toBe(6);                                      // the blank rows are not counted
  });
  it("reads native Excel date cells and text dates from an .xlsx", async () => {
    const bytes = await workbook([["Fictional Expo", "SA", "Riyadh", "Hall", new Date(Date.UTC(2026, 9, 12)), "2026-10-16"], ["Other Show", "Poland", null, null, new Date(Date.UTC(2026, 2, 3)), new Date(Date.UTC(2026, 2, 5))]]);
    const r = await parseEventsFile(bytes, "calendar.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r.file.rows).toMatchObject([{ row: 2, name: "Fictional Expo", country: "SA", start: "2026-10-12", end: "2026-10-16" }, { row: 3, name: "Other Show", country: "PL", start: "2026-03-03", end: "2026-03-05" }]);
  });
  it("reads the downloadable template back as a valid empty file and says what is missing from a wrong one", async () => {
    const tpl = await parseEventsFile(await buildEventsTemplate(), "events-import-template.xlsx");
    expect(tpl).toMatchObject({ ok: true, file: { rows: [], rejected: [], sourceRows: 0 } });
    const noEnd = await parseEventsFile(enc("Event name,Country,Start date\nA,AE,2026-01-01"), "x.csv");
    expect(noEnd).toEqual({ ok: false, error: expect.stringMatching(/no End date column/) });
    expect(await parseEventsFile(enc("hello"), "x.csv")).toMatchObject({ ok: false, error: expect.stringMatching(/No header row/) });
    expect(await parseEventsFile(enc("x"), "x.pdf")).toMatchObject({ ok: false });
  });
  it("neutralised cells and alternative headers are understood", async () => {
    const r = await parseEventsFile(enc("Exhibition,Country,Location,Start,End\n'=Fictional Show,AE,Hall 2,2026-05-01,2026-05-02"), "x.csv");
    if (!r.ok) throw new Error(r.error);
    expect(r.file.rows[0]).toMatchObject({ name: "=Fictional Show", venue: "Hall 2" });
  });
});

function deps(over: Partial<ImportDeps> = {}, dbResult: unknown = null, dbError: string | null = null) {
  const rpc = vi.fn(async () => ({ data: dbResult, error: dbError ? { message: dbError } : null }));
  return { rpc, deps: { db: { rpc } as never, ctx: { grants: [{}] }, ...over } as ImportDeps };
}
const csv = [HEAD, "Fictional Expo,AE,Dubai,Hall,2026-10-12,2026-10-16", "Fictional Expo,AE,Dubai,Hall,2027-10-11,2027-10-15"].join("\n");
const dbRows = [
  { row: 2, status: "new_event", reason: null, note: null, event: "Fictional Expo", eventIsNew: false, start: "2026-10-12", end: "2026-10-16", country: "AE", city: "Dubai", venue: "Hall" },
  { row: 3, status: "new_edition", reason: null, note: null, event: "Fictional Expo", eventIsNew: true, start: "2027-10-11", end: "2027-10-15", country: "AE", city: "Dubai", venue: "Hall" },
];

describe("the import flow", () => {
  it("refuses signed-out and no-access people before reading the file", async () => {
    const a = deps({ ctx: null }); const b = deps({ ctx: { grants: [] } });
    expect(await runEventsImport(a.deps, { fileName: "a.csv", bytes: enc(csv), mode: "preview" })).toMatchObject({ ok: false, status: 401 });
    expect(await runEventsImport(b.deps, { fileName: "a.csv", bytes: enc(csv), mode: "preview" })).toMatchObject({ ok: false, status: 403 });
    expect(a.rpc).not.toHaveBeenCalled(); expect(b.rpc).not.toHaveBeenCalled();
  });
  it("previews through the database (writing nothing) and merges file-level errors with the database's classification", async () => {
    const { rpc, deps: d } = deps({}, { applied: false, blocked: false, stale: false, createdEvents: 0, createdEditions: 0, summary: { newEvents: 1, newEditions: 2 }, rows: dbRows });
    const bad = csv + "\n,AE,,,2026-01-01,2026-01-02";
    const res = await runEventsImport(d, { fileName: "a.csv", bytes: enc(bad), mode: "preview" });
    expect(rpc).toHaveBeenCalledWith("crm_import_events", { p_rows: expect.any(Array), p_apply: false, p_expect: null });
    expect(res).toMatchObject({ ok: true, mode: "preview", canConfirm: false, summary: { fileRows: 3, newEvents: 1, newEditions: 2, needsCorrection: 1 } });
    if (res.ok && res.mode === "preview") expect(res.rows.map((r) => [r.row, r.status])).toEqual([[2, "new_event"], [3, "new_edition"], [4, "invalid"]]);
  });
  it("refuses to confirm while the file itself has bad rows, and never calls the database for it", async () => {
    const { rpc, deps: d } = deps();
    const res = await runEventsImport(d, { fileName: "a.csv", bytes: enc(csv + "\n,AE,,,x,y"), mode: "confirm", expect: 2 });
    expect(res).toMatchObject({ ok: false, status: 409, code: "needs_correction" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("confirms with the previewed count, reports what was added and skipped, and passes a stale or blocked answer on", async () => {
    const ok = deps({}, { applied: true, blocked: false, stale: false, createdEvents: 1, createdEditions: 2, summary: { newEvents: 1, newEditions: 2 }, rows: dbRows });
    const res = await runEventsImport(ok.deps, { fileName: "a.csv", bytes: enc(csv), mode: "confirm", expect: 2 });
    expect(ok.rpc).toHaveBeenCalledWith("crm_import_events", { p_rows: expect.any(Array), p_apply: true, p_expect: 2 });
    expect(res).toMatchObject({ ok: true, mode: "confirm", added: { events: 1, editions: 2 }, skipped: 0 });
    const stale = deps({}, { applied: false, blocked: false, stale: true, createdEvents: 0, createdEditions: 0, summary: { newEvents: 1, newEditions: 3 }, rows: dbRows });
    expect(await runEventsImport(stale.deps, { fileName: "a.csv", bytes: enc(csv), mode: "confirm", expect: 2 })).toMatchObject({ ok: false, status: 409, code: "preview_stale" });
    const blocked = deps({}, { applied: false, blocked: true, stale: false, createdEvents: 0, createdEditions: 0, summary: { newEvents: 0, newEditions: 0 }, rows: dbRows.map((r) => ({ ...r, status: "conflict" })) });
    expect(await runEventsImport(blocked.deps, { fileName: "a.csv", bytes: enc(csv), mode: "confirm", expect: 2 })).toMatchObject({ ok: false, status: 409, code: "needs_correction" });
  });
  it("turns a database refusal into a sentence and a duplicate-key race into a fresh-preview request", async () => {
    expect(await runEventsImport(deps({}, null, "You do not have Sales access").deps, { fileName: "a.csv", bytes: enc(csv), mode: "preview" })).toMatchObject({ ok: false, status: 403 });
    expect(await runEventsImport(deps({}, null, 'duplicate key value violates unique constraint "uq_crm_events_name"').deps, { fileName: "a.csv", bytes: enc(csv), mode: "confirm", expect: 2 })).toMatchObject({ ok: false, status: 409, code: "preview_stale" });
  });
});
