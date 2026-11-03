import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "@/lib/projects/errors";
import type { InvProjectNoteEventRow, InvProjectNoteRow, InvProjectNoteStatusRow } from "@/types/inventory";
import { buildNoteViews, toWaitingNotes, type NoteView, type WaitingNote } from "./project-notes";

/**
 * The loaders behind dispatch notes and return checklists. Everything is read through the signed-in person's own session, so row-level security decides who
 * sees which note (project members and Projects founders of the project's company, Inventory warehouse / stock readers of the warehouse company). A failed read
 * THROWS: the page says "could not load", never "no notes" or "nothing waiting". A database that does not have the notes yet (the migration is not applied) is
 * "not installed": nothing to show, which is not a failure.
 */
type Db = Awaited<ReturnType<typeof createClient>>;
type DbError = { message: string; code?: string } | null;

export type NotesLoad = { state: "ok"; notes: NoteView[] } | { state: "not_installed" };

const chunk = <T,>(items: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError }>): Promise<{ rows: T[]; notInstalled: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) {
      if (isNotInstalled(error)) return { rows: [], notInstalled: true };
      throw new Error(error.message);
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return { rows, notInstalled: false };
  }
}

/** Every note of one project (newest first) with its current state and its history. Throws when a read fails. */
export async function loadProjectNotes(projectId: string): Promise<NotesLoad> {
  const db = await createClient();
  const [notes, statuses, events] = await Promise.all([
    selectAll<InvProjectNoteRow>((a, b) => db.from("inv_project_notes").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).order("id").range(a, b)),
    selectAll<InvProjectNoteStatusRow>((a, b) => db.from("inv_project_note_status").select("*").eq("project_id", projectId).order("note_id").range(a, b)),
    selectAll<InvProjectNoteEventRow>((a, b) => db.from("inv_project_note_events").select("*").eq("project_id", projectId).order("seq").range(a, b)),
  ]);
  if (notes.notInstalled || statuses.notInstalled || events.notInstalled) return { state: "not_installed" };
  const views = buildNoteViews(notes.rows, statuses.rows, events.rows);
  // A note that came back without its status row cannot be shown as anything: that is a failed read, not a note to hide.
  if (views.length !== notes.rows.length) throw new Error("A note was read without its current state");
  return { state: "ok", notes: views };
}

/** One note with its state and history, for the PDF. Null only when the database answered and the person cannot see (or there is no) such note. Throws when a read fails. */
export async function loadNote(projectId: string, noteId: string): Promise<NoteView | null> {
  const db = await createClient();
  const { data: note, error } = await db.from("inv_project_notes").select("*").eq("id", noteId).eq("project_id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!note) return null;
  const [status, events] = await Promise.all([
    db.from("inv_project_note_status").select("*").eq("note_id", note.id).maybeSingle(),
    db.from("inv_project_note_events").select("*").eq("note_id", note.id).order("seq"),
  ]);
  if (status.error) throw new Error(status.error.message);
  if (events.error) throw new Error(events.error.message);
  if (!status.data) throw new Error("The note was read without its current state");
  // The numbers of the notes it cites or is replaced by (for "Replaces ..." and "Superseded by ..."); a citation that cannot be read is simply not named.
  const cited = [...new Set([status.data.superseded_by_note_id, status.data.replaces_note_id, note.replaces_note_id].filter((x): x is string => !!x))];
  const names = cited.length > 0 ? await db.from("inv_project_notes").select("id, note_no").in("id", cited) : { data: [], error: null };
  if (names.error) throw new Error(names.error.message);
  const [view] = buildNoteViews([note], [status.data], events.data ?? []);
  if (!view) throw new Error("The note could not be assembled");
  return { ...view, noteNos: new Map([...(names.data ?? []).map((n) => [n.id, n.note_no] as const), [note.id, note.note_no] as const]) };
}

/** What a failed or empty read means on My Day: "none" (not installed, or nothing waiting), "error" (could not check), or the notes waiting. */
export type WaitingNotesLoad = { status: "none" } | { status: "error" } | { status: "ok"; notes: WaitingNote[] };

/** The notes THE CALLER can answer right now (current PM, an acting PM, a Projects founder), oldest first. For My Day / Needs me. */
export async function loadWaitingNotes(): Promise<WaitingNotesLoad> {
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("inv_notes_waiting_for_me");
    if (error) return isNotInstalled(error) ? { status: "none" } : { status: "error" };
    if (!Array.isArray(data)) return { status: "error" };
    return data.length === 0 ? { status: "none" } : { status: "ok", notes: toWaitingNotes(data) };
  } catch {
    return { status: "error" };
  }
}

/** Notes with a difference the warehouse has not answered yet, for the warehouse Today list. `locationId` narrows to one warehouse. Throws when a read fails; [] when notes are not installed. */
export async function loadOpenDifferences(locationId: string | null): Promise<NoteView[]> {
  const db = await createClient();
  const open = await selectAll<InvProjectNoteStatusRow>((a, b) => db.from("inv_project_note_status").select("*").eq("difference_state", "open").is("superseded_by_note_id", null).order("pending_since").order("note_id").range(a, b));
  if (open.notInstalled || open.rows.length === 0) return [];
  const ids = open.rows.map((s) => s.note_id);
  const notes: InvProjectNoteRow[] = [];
  const events: InvProjectNoteEventRow[] = [];
  for (const part of chunk(ids, 100)) {
    let nq = db.from("inv_project_notes").select("*").in("id", part);
    if (locationId) nq = nq.eq("location_id", locationId);
    const [n, e] = await Promise.all([nq, db.from("inv_project_note_events").select("*").in("note_id", part).order("seq")]);
    if (n.error) throw new Error(n.error.message);
    if (e.error) throw new Error(e.error.message);
    notes.push(...(n.data ?? []));
    events.push(...(e.data ?? []));
  }
  const views = buildNoteViews(notes, open.rows, events);
  if (views.length !== notes.length) throw new Error("A note was read without its current state");
  return views.sort((a, b) => (a.status.difference_reported_at ?? "").localeCompare(b.status.difference_reported_at ?? ""));
}
