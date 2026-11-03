import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));

import { loadNote, loadOpenDifferences, loadProjectNotes, loadWaitingNotes } from "./project-notes-data";

const note = { id: "n1", note_no: "ENG-D-00017", kind: "dispatch", project_id: "p1", company_id: "c1", location_id: "l1", created_at: "2026-11-14T03:42:00Z", payload: { lines: [{ n: 1, item_name: "Laptop", qty: 1 }] }, payload_hash: "abcd1234", replaces_note_id: null };
const status = { note_id: "n1", state: "waiting_for_pm", awaiting: "pm", superseded_by_note_id: null, replaces_note_id: null, difference_state: "none", pending_since: "2026-11-14T03:42:00Z" };
const notInstalled = { data: null, error: { message: 'relation "public.inv_project_notes" does not exist', code: "42P01" } } as FakeResult;

beforeEach(() => {
  tables = { inv_project_notes: rows([note]), inv_project_note_status: rows([status]), inv_project_note_events: rows([]) };
  rpcs = {};
});

describe("loadProjectNotes", () => {
  it("joins each note with its current state and history", async () => {
    const r = await loadProjectNotes("p1");
    expect(r.state === "ok" && r.notes.map((v) => [v.note.note_no, v.status.state])).toEqual([["ENG-D-00017", "waiting_for_pm"]]);
  });
  it("a failed read of any of the three throws: it is never 'no notes'", async () => {
    for (const t of ["inv_project_notes", "inv_project_note_status", "inv_project_note_events"]) {
      tables = { ...tables, [t]: failing() };
      await expect(loadProjectNotes("p1"), t).rejects.toThrow();
      tables = { inv_project_notes: rows([note]), inv_project_note_status: rows([status]), inv_project_note_events: rows([]) };
    }
  });
  it("a note read without its state is a failed read, not a note to hide", async () => {
    tables = { ...tables, inv_project_note_status: rows([]) };
    await expect(loadProjectNotes("p1")).rejects.toThrow(/without its current state/);
  });
  it("a database without the notes yet is 'not installed', which is not a failure", async () => {
    tables = { ...tables, inv_project_notes: notInstalled };
    expect(await loadProjectNotes("p1")).toEqual({ state: "not_installed" });
  });
  it("a project without notes is an ok, empty list", async () => {
    tables = { inv_project_notes: rows([]), inv_project_note_status: rows([]), inv_project_note_events: rows([]) };
    expect(await loadProjectNotes("p1")).toEqual({ state: "ok", notes: [] });
  });
});

describe("loadNote (the PDF)", () => {
  it("is null only when the database answered and there is no such note for this person", async () => {
    tables = { ...tables, inv_project_notes: { data: null, error: null } };
    expect(await loadNote("p1", "n1")).toBeNull();
  });
  it("returns the note with its state and history", async () => {
    tables = { inv_project_notes: row(note), inv_project_note_status: row(status), inv_project_note_events: rows([]) };
    const v = await loadNote("p1", "n1");
    expect(v?.note.note_no).toBe("ENG-D-00017");
    expect(v?.status.state).toBe("waiting_for_pm");
  });
  it("throws on a failed read, whichever of the reads it is", async () => {
    for (const t of ["inv_project_notes", "inv_project_note_status", "inv_project_note_events"]) {
      tables = { inv_project_notes: row(note), inv_project_note_status: row(status), inv_project_note_events: rows([]), [t]: failing() };
      await expect(loadNote("p1", "n1"), t).rejects.toThrow();
    }
  });
  it("a note without its state throws rather than printing a document that looks acknowledged", async () => {
    tables = { inv_project_notes: row(note), inv_project_note_status: { data: null, error: null }, inv_project_note_events: rows([]) };
    await expect(loadNote("p1", "n1")).rejects.toThrow(/without its current state/);
  });
});

describe("loadWaitingNotes (My Day)", () => {
  it("none when nothing waits, ok with the notes, error when the read fails, none when not installed", async () => {
    expect(await loadWaitingNotes()).toEqual({ status: "none" });
    rpcs = { inv_notes_waiting_for_me: rows([{ note_id: "n1", note_no: "ENG-D-1", kind: "dispatch", project_id: "p", project_ref: "R", project_name: "N", waiting_since: "2026-11-01" }]) };
    expect(await loadWaitingNotes()).toMatchObject({ status: "ok", notes: [{ noteNo: "ENG-D-1" }] });
    rpcs = { inv_notes_waiting_for_me: failing() };
    expect(await loadWaitingNotes()).toEqual({ status: "error" });
    rpcs = { inv_notes_waiting_for_me: { data: null, error: { message: "Could not find the function", code: "PGRST202" } } };
    expect(await loadWaitingNotes()).toEqual({ status: "none" });
  });
});

describe("loadOpenDifferences (warehouse Today)", () => {
  it("is empty when nothing is open or the notes are not installed, and throws when a read fails", async () => {
    tables = { inv_project_note_status: rows([]) };
    expect(await loadOpenDifferences(null)).toEqual([]);
    tables = { inv_project_note_status: notInstalled };
    expect(await loadOpenDifferences(null)).toEqual([]);
    tables = { inv_project_note_status: failing() };
    await expect(loadOpenDifferences(null)).rejects.toThrow();
  });
  it("lists the notes with an open difference, oldest report first", async () => {
    tables = {
      inv_project_note_status: rows([{ ...status, state: "difference_open", difference_state: "open", difference_reported_at: "2026-11-15T08:00:00Z" }]),
      inv_project_notes: rows([note]), inv_project_note_events: rows([]),
    };
    const r = await loadOpenDifferences("l1");
    expect(r.map((v) => v.note.note_no)).toEqual(["ENG-D-00017"]);
  });
  it("a note that cannot be read after its open state was read is a failure, never a vanished row", async () => {
    tables = { inv_project_note_status: rows([{ ...status, difference_state: "open" }]), inv_project_notes: failing(), inv_project_note_events: rows([]) };
    await expect(loadOpenDifferences(null)).rejects.toThrow();
  });
});
