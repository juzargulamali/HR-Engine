import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const calls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcResult: { data: unknown; error: { message: string } | null } = { data: {}, error: null };
let movement: { data: unknown; error: { message: string } | null } = { data: { id: "mv-9" }, error: null };
let note: { data: unknown; error: { message: string } | null } = { data: { company_id: "c1" }, error: null };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return rpcResult; },
    from: (t: string) => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => movement }), maybeSingle: async () => (t === "inv_project_notes" ? note : movement) }) }) }),
  }),
}));

import { answerNote, resolveDifference } from "./inventoryNotes";

const N = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x); return f; };

beforeEach(() => { calls.length = 0; rpcResult = { data: {}, error: null }; movement = { data: { id: "mv-9" }, error: null }; note = { data: { company_id: "c1" }, error: null }; });

describe("answerNote", () => {
  it("acknowledges through the database function, with an optional note", async () => {
    expect(await answerNote({ error: null }, form({ noteId: N, projectId: P, action: "acknowledge", comment: "Seen" }))).toEqual({ error: null });
    expect(calls).toEqual([{ fn: "inv_ack_project_note", args: { p_note_id: N, p_action: "acknowledge", p_lines: null, p_comment: "Seen", p_reason: null } }]);
  });
  it("a difference needs the lines and what differs, before anything is sent", async () => {
    expect((await answerNote({ error: null }, form({ noteId: N, projectId: P, action: "report_difference", reason: "quantity_differs" }))).error).toBe("Tick the line or lines that differ");
    expect((await answerNote({ error: null }, form({ noteId: N, projectId: P, action: "report_difference", line: "1" }))).error).toBe("Say what is different");
    expect((await answerNote({ error: null }, form({ noteId: N, projectId: P, action: "report_difference", line: "1", reason: "other" }))).error).toBe("Describe the difference in the comment");
    expect(calls).toEqual([]);
  });
  it("sends the ticked line numbers and the reason", async () => {
    await answerNote({ error: null }, form({ noteId: N, projectId: P, action: "report_difference", line: ["2", "3"], reason: "quantity_differs", comment: "Two short" }));
    expect(calls[0]!.args).toMatchObject({ p_lines: [2, 3], p_reason: "quantity_differs", p_comment: "Two short", p_action: "report_difference" });
  });
  it("shows the database's own refusal in words and never claims success", async () => {
    rpcResult = { data: null, error: { message: "Only the project's Project Manager, an acting Project Manager or a Projects founder can answer this note" } };
    expect((await answerNote({ error: null }, form({ noteId: N, projectId: P, action: "acknowledge" }))).error).toMatch(/Only the project's Project Manager/);
  });
  it("refuses an address that is not an id or an action it does not know", async () => {
    expect((await answerNote({ error: null }, form({ noteId: "x", projectId: P, action: "acknowledge" }))).error).toBeTruthy();
    expect((await answerNote({ error: null }, form({ noteId: N, projectId: P, action: "approve" }))).error).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

describe("resolveDifference", () => {
  it("needs a comment, and for a correction the reference of the movement", async () => {
    expect((await resolveDifference({ error: null }, form({ noteId: N, projectId: P, resolution: "record_stands" }))).error).toMatch(/Say what the warehouse found/);
    expect((await resolveDifference({ error: null }, form({ noteId: N, projectId: P, resolution: "corrected", comment: "Fixed" }))).error).toMatch(/Name the movement/);
    expect(calls).toEqual([]);
  });
  it("the record stands: no movement is named", async () => {
    expect(await resolveDifference({ error: null }, form({ noteId: N, projectId: P, resolution: "record_stands", comment: "Counted again, 12 is right" }))).toEqual({ error: null });
    expect(calls).toEqual([{ fn: "inv_resolve_note_difference", args: { p_note_id: N, p_resolution: "record_stands", p_comment: "Counted again, 12 is right", p_linked_movement_id: null } }]);
  });
  it("corrected: the typed reference is looked up and its movement is named", async () => {
    await resolveDifference({ error: null }, form({ noteId: N, projectId: P, resolution: "corrected", comment: "Re-recorded", movementCode: " eng-m-00044 " }));
    expect(calls[0]!.args).toMatchObject({ p_resolution: "corrected", p_linked_movement_id: "mv-9" });
  });
  it("a reference that matches no movement is said, and nothing is sent", async () => {
    movement = { data: null, error: null };
    expect((await resolveDifference({ error: null }, form({ noteId: N, projectId: P, resolution: "corrected", comment: "x", movementCode: "ENG-M-1" }))).error).toMatch(/No movement has the reference ENG-M-1/);
    expect(calls).toEqual([]);
  });
  it("a failed lookup is a failure, not 'no such movement'", async () => {
    movement = { data: null, error: { message: "the data service did not answer" } };
    const r = await resolveDifference({ error: null }, form({ noteId: N, projectId: P, resolution: "corrected", comment: "x", movementCode: "ENG-M-1" }));
    expect(r.error).toBe("the data service did not answer");
    expect(calls).toEqual([]);
  });
});
