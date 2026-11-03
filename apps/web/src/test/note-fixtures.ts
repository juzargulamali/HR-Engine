import { buildNoteViews, type NoteView } from "@/lib/inventory/project-notes";
import type { InvProjectNoteEventRow, InvProjectNoteRow, InvProjectNoteStatusRow } from "@/types/inventory";

/** One dispatch note as the database freezes it, with its status row and events: the shared fixture of the note tests. */
export const noteRow = (over: Partial<InvProjectNoteRow> = {}): InvProjectNoteRow => ({
  id: "n1", company_id: "c1", kind: "dispatch", note_no: "ENG-D-00017", movement_id: "m1", movement_code: "ENG-M-00031", project_id: "p1", project_company_id: "c1",
  project_ref: "ENG-P-2026-0007", project_name: "Mall activation", destination: "Dubai Mall, Level 2 service entrance", site_timezone: "Asia/Dubai", location_id: "l1",
  location_name: "Dubai warehouse", location_timezone: "Asia/Dubai", recorded_by: "u1", recorded_by_name: "A. Warehouse", recorded_by_role: "Warehouse operator",
  pm_user_id_at_time: "u2", pm_name_at_time: "M. Manager", occurred_at: "2026-11-14T03:42:00Z", expected_return_at: "2026-11-21T13:00:00Z", request_id: null, request_code: "ENG-R-00004",
  replaces_note_id: null, payload_hash: "8f3ac21d99aa",
  payload: {
    schema: 1,
    lines: [
      { n: 1, item_name: "Laptop 14 inch", manufacturer: "Dell", model: "XPS", unit_id: "u", equipment_id: "ENG-E-00012", serial: "SN-88123", qty: 1, uom: "each", condition: "good" },
      { n: 2, item_name: "HDMI cable 5 m", unit_id: null, equipment_id: null, serial: null, qty: 12, uom: "each", condition: "good" },
      { n: 3, item_name: "Power cable", unit_id: null, equipment_id: null, serial: null, qty: 15.25, uom: "m", condition: "good" },
    ],
  },
  created_at: "2026-11-14T03:42:01Z", ...over,
});

export const statusRow = (over: Partial<InvProjectNoteStatusRow> = {}): InvProjectNoteStatusRow => ({
  note_id: "n1", company_id: "c1", project_id: "p1", kind: "dispatch", note_no: "ENG-D-00017", created_at: "2026-11-14T03:42:01Z", replaces_note_id: null, superseded_by_note_id: null,
  acknowledged_at: null, acknowledged_by: null, acknowledged_by_name: null, acknowledged_capacity: null, difference_state: "none", difference_reported_at: null, difference_reason: null,
  difference_lines: null, awaiting: "pm", pending_since: "2026-11-14T03:42:01Z", state: "waiting_for_pm", ...over,
});

export const eventRow = (over: Partial<InvProjectNoteEventRow> = {}): InvProjectNoteEventRow => ({
  id: "e1", seq: 1, note_id: "n1", company_id: "c1", project_id: "p1", event: "acknowledged", by_user: "u2", by_name: "M. Manager", capacity: "pm", at: "2026-11-14T05:10:00Z",
  reason: null, lines: null, comment: null, linked_note_id: null, linked_movement_id: null, ...over,
});

export const noteView = (n: InvProjectNoteRow = noteRow(), s: InvProjectNoteStatusRow = statusRow(), events: InvProjectNoteEventRow[] = []): NoteView => buildNoteViews([n], [s], events)[0]!;

export const returnNoteRow = (over: Partial<InvProjectNoteRow> = {}): InvProjectNoteRow => noteRow({
  kind: "return", note_no: "ENG-RT-00005", id: "n2", movement_code: "ENG-M-00044",
  payload: {
    schema: 1,
    lines: [
      { n: 1, item_name: "Laptop 14 inch", equipment_id: "ENG-E-00012", serial: "SN-88123", qty: 1, uom: "each", condition: "good", outcome: "available" },
      { n: 2, item_name: "Laptop 14 inch", equipment_id: "ENG-E-00013", serial: "SN-88124", qty: 1, uom: "each", condition: "damaged", outcome: "held" },
      { n: 3, item_name: "HDMI cable 5 m", equipment_id: null, serial: null, qty: 10, uom: "each", condition: "good", outcome: "available" },
    ],
    totals: [
      { item_name: "HDMI cable 5 m", uom: "each", individual: false, sent: 12, returned_before: 0, received_now: 10, still_out: 2 },
      { item_name: "Laptop 14 inch", uom: "each", individual: true, sent: 2, returned_before: 0, received_now: 2, still_out: 0 },
    ],
  },
  ...over,
});
