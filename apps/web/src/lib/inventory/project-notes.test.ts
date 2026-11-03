import { describe, expect, it } from "vitest";
import {
  ageText, buildNoteViews, contentId, eventText, formatNoteInstant, noteStateWord, notePdfFileName, parseNotePayload, reasonWord, toWaitingNotes, outcomeWord, lineTitle, lineIdentity, lineQtyText,
} from "./project-notes";
import type { InvProjectNoteEventRow, InvProjectNoteRow, InvProjectNoteStatusRow } from "@/types/inventory";

describe("formatNoteInstant", () => {
  it("writes the instant in the warehouse's zone and names the zone", () => {
    expect(formatNoteInstant("2026-11-14T03:42:00Z", "Asia/Dubai")).toBe("14 Nov 2026, 07:42 (Asia/Dubai)");
    expect(formatNoteInstant("2026-03-29T00:30:00Z", "Europe/Warsaw")).toBe("29 Mar 2026, 01:30 (Europe/Warsaw)");
  });
  it("never throws on an unknown zone or a bad date", () => {
    expect(formatNoteInstant("2026-11-14T03:42:00Z", "Not/AZone")).toBe("14 Nov 2026, 03:42 (UTC)");
    expect(formatNoteInstant("nonsense", "UTC")).toBe("—");
    expect(formatNoteInstant(null, "UTC")).toBe("—");
  });
});

describe("ageText", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  it("counts whole days", () => {
    expect(ageText("2026-11-14T08:00:00Z", now)).toBe("today");
    expect(ageText("2026-11-13T08:00:00Z", now)).toBe("1 day");
    expect(ageText("2026-11-10T08:00:00Z", now)).toBe("4 days");
  });
});

describe("noteStateWord", () => {
  const s = (state: InvProjectNoteStatusRow["state"], kind: "dispatch" | "return" = "dispatch") => ({ state, kind });
  it("says what a pending note waits for, to the person who can answer and to everyone else", () => {
    expect(noteStateWord(s("waiting_for_pm"), true).label).toBe("Dispatch waiting for you");
    expect(noteStateWord(s("waiting_for_pm", "return"), true).label).toBe("Returned, please confirm");
    expect(noteStateWord(s("waiting_for_pm"), false).label).toBe("Waiting for the Project Manager");
  });
  it("names the replacement of a superseded note and keeps a difference visible", () => {
    expect(noteStateWord(s("superseded"), true, "ENG-D-00018").label).toBe("Superseded by ENG-D-00018");
    expect(noteStateWord(s("difference_open"), true).tone).toBe("destructive");
    expect(noteStateWord(s("acknowledged"), false).tone).toBe("success");
  });
});

describe("parseNotePayload", () => {
  it("reads lines and totals field by field and never trusts the shape", () => {
    const p = parseNotePayload({
      lines: [{ n: 1, item_name: "Laptop", manufacturer: "Dell", model: "XPS", equipment_id: "E-1", serial: "SN1", qty: 1, uom: "each", condition: "fair", outcome: "available" }, { qty: "12.5", uom: "m" }, "junk"],
      totals: [{ item_name: "Laptop", individual: true, sent: 2, returned_before: 0, received_now: 1, still_out: 1 }],
    });
    expect(p.lines).toHaveLength(3);
    expect(lineTitle(p.lines[0]!)).toBe("Laptop · Dell · XPS");
    expect(lineIdentity(p.lines[0]!)).toBe("E-1 / SN1");
    expect(lineIdentity(p.lines[1]!)).toBe("—");
    expect(lineQtyText(p.lines[1]!)).toBe("12.5 m");
    expect(outcomeWord(p.lines[0]!.outcome)).toBe("Back, available");
    expect(p.totals[0]).toMatchObject({ sent: 2, stillOut: 1, individual: true });
    expect(parseNotePayload(null)).toEqual({ lines: [], totals: [] });
  });
});

describe("buildNoteViews", () => {
  const note = (id: string, no: string, at: string) => ({ id, note_no: no, created_at: at, payload: { lines: [] } }) as unknown as InvProjectNoteRow;
  const st = (id: string) => ({ note_id: id, state: "waiting_for_pm" }) as unknown as InvProjectNoteStatusRow;
  const ev = (id: string, noteId: string, seq: number) => ({ id, note_id: noteId, seq, event: "acknowledged" }) as unknown as InvProjectNoteEventRow;
  it("lists the newest first, with the history in order, and leaves out a note it cannot give a state to", () => {
    const views = buildNoteViews([note("a", "D-1", "2026-11-01"), note("b", "D-2", "2026-11-02"), note("c", "D-3", "2026-11-03")], [st("a"), st("b")], [ev("e2", "a", 2), ev("e1", "a", 1)]);
    expect(views.map((v) => v.note.note_no)).toEqual(["D-2", "D-1"]);
    expect(views[1]!.events.map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe("history words", () => {
  const e = (over: Partial<InvProjectNoteEventRow>) => ({ by_name: "M. Manager", capacity: "pm", reason: null, lines: null, comment: null, linked_note_id: null, ...over }) as InvProjectNoteEventRow;
  it("says each event in plain words", () => {
    expect(eventText(e({ event: "acknowledged" }), "dispatch")).toBe("Acknowledged by M. Manager (Project Manager)");
    expect(eventText(e({ event: "difference_reported", reason: "quantity_differs", lines: [2, 3], comment: "Two missing" }), "dispatch")).toBe("Difference reported by M. Manager (Project Manager): Quantity differs (lines 2, 3). Two missing");
    expect(eventText(e({ event: "resolved_corrected", by_name: "A. W.", capacity: "warehouse", comment: "Recounted", linked_note_id: "x" }), "dispatch", new Map([["x", "ENG-D-00018"]]))).toBe("Warehouse answer by A. W.: corrected, see ENG-D-00018. Recounted");
  });
  it("names reasons by the kind of note", () => {
    expect(reasonWord("return", "missing_from_list")).toBe("Something returned is missing from the list");
    expect(reasonWord("dispatch", "not_on_site")).toBe("Not on site");
    expect(reasonWord("dispatch", "other")).toBe("Other");
  });
});

describe("small helpers", () => {
  it("makes a short content id, a safe file name and waiting rows", () => {
    expect(contentId("8f3ac21d99aa")).toBe("8f3a-c21d");
    expect(notePdfFileName("ENG-D-00017")).toBe("ENG-D-00017.pdf");
    expect(notePdfFileName("../x y")).toBe("x-y.pdf");
    expect(toWaitingNotes([{ note_id: "n", note_no: "ENG-RT-1", kind: "return", project_id: "p", project_ref: "R", project_name: "N", waiting_since: "2026-11-01" }])[0]).toMatchObject({ kind: "return", noteNo: "ENG-RT-1" });
  });
});
