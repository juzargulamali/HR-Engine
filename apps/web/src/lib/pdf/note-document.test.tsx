// @vitest-environment node
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { buildNoteViews } from "@/lib/inventory/project-notes";
import { noteRow, noteView, statusRow } from "@/test/note-fixtures";

vi.mock("server-only", () => ({}));

const note = noteRow;
const status = statusRow;
const view = noteView;

describe("note band and acknowledgement wording", () => {
  it("is pending until acknowledged, with no claim of a legal signature", async () => {
    const { noteBand, acknowledgementLines } = await import("./note-document");
    expect(noteBand(view()).text).toBe("ACKNOWLEDGEMENT PENDING");
    const text = acknowledgementLines(view()).join(" ");
    expect(text).toMatch(/Pending: the Project Manager has not yet acknowledged this list/);
    expect(text).not.toMatch(/signature|signed|sign /i);
  });
  it("names who acknowledged, in what capacity and when, after acknowledgement", async () => {
    const { noteBand, acknowledgementLines } = await import("./note-document");
    const v = view(note(), status({ state: "acknowledged", awaiting: null, acknowledged_at: "2026-11-14T05:10:00Z", acknowledged_by_name: "M. Manager", acknowledged_capacity: "pm" }));
    expect(noteBand(v).text).toBe("ACKNOWLEDGED BY M. MANAGER");
    const text = acknowledgementLines(v).join(" ");
    expect(text).toContain("Acknowledged in ENGINIOUS OS by M. Manager (Project Manager) on 14 Nov 2026, 09:10 (Asia/Dubai), using an authenticated account");
    expect(text).not.toMatch(/signature|signed/i);
  });
  it("shows an open difference and a replacement", async () => {
    const { noteBand } = await import("./note-document");
    expect(noteBand(view(note(), status({ state: "difference_open", awaiting: "warehouse", difference_state: "open" }))).text).toContain("DIFFERENCE REPORTED");
    const old = note({ id: "n0", note_no: "ENG-D-00016" });
    const superseded = buildNoteViews([old, note({ replaces_note_id: "n0" })], [status({ note_id: "n0", state: "superseded", superseded_by_note_id: "n1", awaiting: null }), status({ replaces_note_id: "n0" })], []).find((x) => x.note.id === "n0")!;
    expect(noteBand(superseded).text).toBe("SUPERSEDED BY ENG-D-00017");
  });
});

describe("note PDF", () => {
  it("renders a real PDF with the Carlito fonts and the logo, from the frozen content alone", async () => {
    const { NoteDocument } = await import("./note-document");
    const buf = await renderToBuffer(createElement(NoteDocument, { view: view(), generatedAt: new Date("2026-11-14T05:12:00Z") }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = buf.toString("latin1");
    expect(text).toMatch(/\+Carlito-Regular/);
    expect(text).toMatch(/\+Carlito-Bold/);
    expect(text).toMatch(/\/Subtype \/Image/);
    expect(text).not.toMatch(/Helvetica/);
  });
  it("renders a return checklist with project totals", async () => {
    const { NoteDocument } = await import("./note-document");
    const n = note({
      kind: "return", note_no: "ENG-RT-00005",
      payload: {
        schema: 1,
        lines: [{ n: 1, item_name: "Laptop 14 inch", equipment_id: "ENG-E-00013", serial: "SN-2", qty: 1, uom: "each", condition: "damaged", outcome: "held" }],
        totals: [{ item_name: "Laptop 14 inch", uom: "each", individual: true, sent: 2, returned_before: 0, received_now: 1, still_out: 1 }, { item_name: "HDMI cable 5 m", uom: "each", individual: false, sent: 12, returned_before: 0, received_now: 10, still_out: 2 }],
      },
    });
    const buf = await renderToBuffer(createElement(NoteDocument, { view: view(n, status({ kind: "return" })), generatedAt: new Date() }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
