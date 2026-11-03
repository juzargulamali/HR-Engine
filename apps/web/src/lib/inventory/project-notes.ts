/**
 * Dispatch notes and return checklists, the pure part (no React, no Next, no database). The database keeps a frozen, numbered copy of what the warehouse
 * recorded (inv_project_notes), an append-only history (inv_project_note_events) and the current state of each note (inv_project_note_status). Everything a
 * person reads about a note is made here from those rows, in one place: the same words on the Project Equipment page, on My Day, on the warehouse Today
 * list and on the PDF. A note never moves stock; the recorded movement stays the only authority for where equipment is.
 */
import type { InvProjectNoteCapacity, InvProjectNoteEventRow, InvProjectNoteRow, InvProjectNoteStatusRow } from "@/types/inventory";
import { CONDITION_WORDS, formatQty } from "./words";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Nov 2026, 07:42 (Asia/Dubai)": an instant in the zone the note was recorded in, with the zone named. An unknown zone is read as UTC, never breaks the page. */
export function formatNoteInstant(iso: string | null | undefined, timeZone: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const zone = (() => { try { new Intl.DateTimeFormat("en-GB", { timeZone: timeZone ?? "UTC" }); return timeZone ?? "UTC"; } catch { return "UTC"; } })();
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms))) parts[p.type] = p.value;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${hour}:${parts.minute} (${zone})`;
}

/** How long a note has waited, in words ("today", "1 day", "3 days"), counted in whole elapsed days. */
export function ageText(sinceIso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(sinceIso);
  if (!Number.isFinite(ms) || ms < 0) return "today";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

export const NOTE_KIND_WORDS = { dispatch: "Dispatch note", return: "Return checklist" } as const;
export const noteKindWord = (kind: string) => (kind === "return" ? NOTE_KIND_WORDS.return : NOTE_KIND_WORDS.dispatch);

export const CAPACITY_WORDS: Record<InvProjectNoteCapacity, string> = {
  pm: "Project Manager",
  acting_pm: "Acting Project Manager",
  projects_founder: "Projects founder, on behalf of the Project Manager",
  warehouse: "Warehouse",
};
export const capacityWord = (c: string | null | undefined) => (c && c in CAPACITY_WORDS ? CAPACITY_WORDS[c as InvProjectNoteCapacity] : "—");

/** What the Project Manager can say is different. The values are exactly what inv_ack_project_note accepts for each kind of note. */
export const DIFFERENCE_REASONS = {
  dispatch: [
    { value: "not_on_site", label: "Not on site" },
    { value: "quantity_differs", label: "Quantity differs" },
    { value: "different_item", label: "Different item" },
    { value: "condition_differs", label: "Condition differs" },
    { value: "other", label: "Other (describe it in the comment)" },
  ],
  return: [
    { value: "not_returned", label: "Not actually returned" },
    { value: "quantity_differs", label: "Quantity differs" },
    { value: "missing_from_list", label: "Something returned is missing from the list" },
    { value: "condition_differs", label: "Condition differs" },
    { value: "other", label: "Other (describe it in the comment)" },
  ],
} as const;
export const reasonWord = (kind: string, value: string | null | undefined): string => {
  if (!value) return "—";
  const list: readonly { value: string; label: string }[] = kind === "return" ? DIFFERENCE_REASONS.return : DIFFERENCE_REASONS.dispatch;
  return (list.find((r) => r.value === value)?.label ?? value).replace(/ \(describe it in the comment\)$/, "");
};

/** The outcome of a returned line, in plain words, from the recorded condition (never chosen by the Project Manager). */
export const OUTCOME_WORDS = { available: "Back, available", held: "Back, held for checking" } as const;
export const outcomeWord = (o: string | null | undefined) => (o === "available" || o === "held" ? OUTCOME_WORDS[o] : "—");

/** The Project Manager's side of the note, as one chip: the word, and who it waits for. */
export type NoteStateWord = { label: string; tone: "warning" | "success" | "destructive" | "outline" };

/** The state as the PROJECT side reads it. `canAnswer` is true for the Project Manager, an acting Project Manager and a Projects founder. */
export function noteStateWord(s: Pick<InvProjectNoteStatusRow, "state" | "kind">, canAnswer: boolean, supersededBy?: string | null): NoteStateWord {
  if (s.state === "superseded") return { label: supersededBy ? `Superseded by ${supersededBy}` : "Superseded", tone: "outline" };
  if (s.state === "difference_open") return { label: "Difference reported, waiting for the warehouse", tone: "destructive" };
  if (s.state === "acknowledged") return { label: "Acknowledged", tone: "success" };
  if (canAnswer) return { label: s.kind === "return" ? "Returned, please confirm" : "Dispatch waiting for you", tone: "warning" };
  return { label: "Waiting for the Project Manager", tone: "warning" };
}

/* ---------- the frozen payload ---------- */

export interface NoteLine {
  n: number;
  itemName: string;
  /** Manufacturer, model and specification as recorded, joined; null when none was recorded. */
  detail: string | null;
  equipmentId: string | null;
  serial: string | null;
  qty: number;
  uom: string;
  condition: string | null;
  /** Returns only: available / held. */
  outcome: "available" | "held" | null;
}
export interface NoteTotal { itemName: string; uom: string; individual: boolean; sent: number; returnedBefore: number; receivedNow: number; stillOut: number }
export interface NotePayload { lines: NoteLine[]; totals: NoteTotal[] }

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const numeric = (v: unknown): number => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN; return Number.isFinite(n) ? n : 0; };

/** Reads the frozen payload field by field and never trusts its shape: a malformed payload gives fewer rows, never a thrown page. */
export function parseNotePayload(payload: unknown): NotePayload {
  const p = rec(payload);
  const lines = (Array.isArray(p.lines) ? p.lines : []).map((raw, i): NoteLine => {
    const l = rec(raw);
    const outcome = l.outcome === "available" || l.outcome === "held" ? l.outcome : null;
    return {
      n: numeric(l.n) || i + 1,
      itemName: text(l.item_name) ?? "Item",
      detail: [text(l.manufacturer), text(l.model), text(l.specification)].filter(Boolean).join(" · ") || null,
      equipmentId: text(l.equipment_id),
      serial: text(l.serial),
      qty: numeric(l.qty),
      uom: text(l.uom) ?? "each",
      condition: text(l.condition),
      outcome,
    };
  });
  const totals = (Array.isArray(p.totals) ? p.totals : []).map((raw): NoteTotal => {
    const t = rec(raw);
    return {
      itemName: text(t.item_name) ?? "Item", uom: text(t.uom) ?? "each", individual: t.individual === true,
      sent: numeric(t.sent), returnedBefore: numeric(t.returned_before), receivedNow: numeric(t.received_now), stillOut: numeric(t.still_out),
    };
  });
  return { lines, totals };
}

export const lineQtyText = (l: Pick<NoteLine, "qty" | "uom">): string => formatQty(l.qty, l.uom === "each" ? undefined : l.uom);
export const totalQtyText = (n: number, t: Pick<NoteTotal, "uom">): string => formatQty(n, t.uom === "each" ? undefined : t.uom);
export const conditionWord = (c: string | null | undefined): string => (c && c in CONDITION_WORDS ? CONDITION_WORDS[c as keyof typeof CONDITION_WORDS] : c ? c : "—");

/** "Laptop 14 inch · Acme · L14": the recorded name with what was recorded about it. */
export const lineTitle = (l: Pick<NoteLine, "itemName" | "detail">): string => (l.detail ? `${l.itemName} · ${l.detail}` : l.itemName);
/** "ENG-E-00012 / SN-88123", just the ID, or a dash for counted stock. */
export const lineIdentity = (l: Pick<NoteLine, "equipmentId" | "serial">): string => (l.equipmentId ? (l.serial ? `${l.equipmentId} / ${l.serial}` : l.equipmentId) : "—");

/** A short, human form of the payload hash, so a paper copy can be matched to the system record ("8f3a-c21d"). */
export function contentId(hash: string): string {
  const h = hash.replace(/[^0-9a-f]/gi, "").toLowerCase();
  return h.length >= 8 ? `${h.slice(0, 4)}-${h.slice(4, 8)}` : h || "—";
}

/* ---------- one note with its state and history ---------- */

export interface NoteView {
  note: InvProjectNoteRow;
  status: InvProjectNoteStatusRow;
  events: InvProjectNoteEventRow[];
  payload: NotePayload;
  /** Note numbers by id, for "Superseded by ..." and "Replaces ...": only the notes that were read. */
  noteNos: ReadonlyMap<string, string>;
}

export const supersededByNo = (v: Pick<NoteView, "status" | "noteNos">): string | null => (v.status.superseded_by_note_id ? v.noteNos.get(v.status.superseded_by_note_id) ?? null : null);
export const replacesNo = (v: Pick<NoteView, "status" | "noteNos">): string | null => (v.status.replaces_note_id ? v.noteNos.get(v.status.replaces_note_id) ?? null : null);

/** Joins the three reads into one view per note (newest first). A note without a status row (it could not be read) is left out rather than shown as acknowledged. */
export function buildNoteViews(notes: readonly InvProjectNoteRow[], statuses: readonly InvProjectNoteStatusRow[], events: readonly InvProjectNoteEventRow[]): NoteView[] {
  const status = new Map(statuses.map((s) => [s.note_id, s]));
  const noteNos = new Map(notes.map((n) => [n.id, n.note_no] as const));
  const byNote = new Map<string, InvProjectNoteEventRow[]>();
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) byNote.set(e.note_id, [...(byNote.get(e.note_id) ?? []), e]);
  return [...notes]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.note_no.localeCompare(a.note_no))
    .flatMap((n) => {
      const s = status.get(n.id);
      return s ? [{ note: n, status: s, events: byNote.get(n.id) ?? [], payload: parseNotePayload(n.payload), noteNos }] : [];
    });
}

/** The lines the Project Manager named in a reported difference, as the line texts (for the history). */
export function differenceLineNumbers(lines: unknown): number[] {
  return (Array.isArray(lines) ? lines : []).map(numeric).filter((n) => n > 0);
}

/** One history line per event, in words. The events are append-only: nothing here is ever edited. */
export function eventText(e: InvProjectNoteEventRow, kind: string, noteNos?: ReadonlyMap<string, string>): string {
  const who = `${e.by_name} (${capacityWord(e.capacity)})`;
  const lines = differenceLineNumbers(e.lines);
  switch (e.event) {
    case "acknowledged": return `Acknowledged by ${who}${e.comment ? `: ${e.comment}` : ""}`;
    case "difference_reported": return `Difference reported by ${who}: ${reasonWord(kind, e.reason)}${lines.length > 0 ? ` (${lines.length === 1 ? "line" : "lines"} ${lines.join(", ")})` : ""}${e.comment ? `. ${e.comment}` : ""}`;
    case "difference_withdrawn": return `Difference withdrawn by ${who}${e.comment ? `: ${e.comment}` : ""}`;
    case "resolved_record_stands": return `Warehouse answer by ${e.by_name}: the record stands. ${e.comment ?? ""}`.trim();
    case "resolved_corrected": return `Warehouse answer by ${e.by_name}: corrected${e.linked_note_id ? `, see ${noteNos?.get(e.linked_note_id) ?? "the new note"}` : ""}. ${e.comment ?? ""}`.trim();
    case "correction_of": return `Made to correct ${e.linked_note_id ? noteNos?.get(e.linked_note_id) ?? "an earlier note" : "an earlier note"}${e.comment ? `: ${e.comment}` : ""}`;
    default: return e.event;
  }
}

/* ---------- Project Manager's "waiting for me" rows (My Day / Needs me) ---------- */

export interface WaitingNote { noteId: string; noteNo: string; kind: "dispatch" | "return"; projectId: string; projectRef: string; projectName: string; waitingSince: string }

export function toWaitingNotes(rows: readonly { note_id: string; note_no: string; kind: string; project_id: string; project_ref: string; project_name: string; waiting_since: string }[]): WaitingNote[] {
  return rows.map((r) => ({ noteId: r.note_id, noteNo: r.note_no, kind: r.kind === "return" ? "return" : "dispatch", projectId: r.project_id, projectRef: r.project_ref, projectName: r.project_name, waitingSince: r.waiting_since }));
}

/** Where a note's PDF and its screen live. The id is a UUID from the database; the project id is the note's own project. */
export const notePdfHref = (projectId: string, noteId: string) => `/projects/${projectId}/equipment/notes/${noteId}/pdf`;
export const projectNotesHref = (projectId: string, noteId?: string) => `/projects/${projectId}/equipment${noteId ? `?note=${noteId}` : ""}#notes`;

/** A file name that is safe in a Content-Disposition header: letters, digits, dot, dash and underscore only. */
export function notePdfFileName(noteNo: string): string {
  const safe = noteNo.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "note";
  return `${safe}.pdf`;
}
