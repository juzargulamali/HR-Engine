import { describe, expect, it } from "vitest";
import type { CrmActivityRow, CrmFollowUpRow } from "@/types/crm";
import { completionNoteBody, matchCompletions, timelineItems } from "./timeline";

// Fictional data only.
const name = (id: string | null | undefined) => (id === "u2" ? "Fictional Sami" : id ? "Fictional Fiona" : "Not recorded");
const followUp = (o: Partial<CrmFollowUpRow> = {}): CrmFollowUpRow => ({
  id: "f1", opportunity_id: "o1", organisation_id: null, company_id: "c1", assigned_to: "u2", title: "Call the venue", kind: "call", due_at: "2026-11-06T06:00:00Z", status: "done",
  completed_at: "2026-11-06T08:00:00.123Z", completed_by: "u2", outcome: "Venue confirmed the hall", created_by: "u1", created_at: "2026-11-03T09:30:00Z", updated_at: "2026-11-06T08:00:00.123Z", ...o,
} as CrmFollowUpRow);
const activity = (o: Partial<CrmActivityRow>): CrmActivityRow => ({ id: "a1", opportunity_id: "o1", company_id: "c1", kind: "note", body: "", is_internal: false, occurred_at: "2026-11-06T08:00:00.123Z", created_by: "u2", created_at: "2026-11-06T08:00:00.123Z", ...o });
const items = (followUps: CrmFollowUpRow[], activities: CrmActivityRow[], firstResponseAt: string | null = null) => timelineItems({ opportunityId: "o1", activities, events: [], followUps, firstResponseAt }, name);
const completed = (list: ReturnType<typeof items>) => list.filter((i) => /done|completed/i.test(i.text));

describe("a completed follow-up is shown once", () => {
  it("the Complete dialog writes the follow-up and an internal note at the same instant with the same outcome: one entry, not two", () => {
    const f = followUp();
    // Exactly what crm_complete_follow_up writes: 'Follow-up done: ' || title || '. ' || outcome, internal, at now() of the same transaction.
    const note = activity({ id: "n1", body: "Follow-up done: Call the venue. Venue confirmed the hall", is_internal: true });
    const list = items([f], [note]);
    expect(completed(list).map((i) => i.id)).toEqual(["fd-f1"]);
    expect(list.find((i) => i.id === "fd-f1")).toMatchObject({ type: "staff", label: "Follow-up", text: "Follow-up completed: Call the venue. Outcome: Venue confirmed the hall", who: "Fictional Sami", mergedRows: 2 });
    expect(list.some((i) => i.id === "a-n1")).toBe(false);
  });
  it("Log activity + complete (a call) writes a third row a moment later with the same words: still one entry, shown as that call with its first-response mark", () => {
    const f = followUp();
    const note = activity({ id: "n1", body: completionNoteBody(f), is_internal: true });
    const call = activity({ id: "c1", kind: "call", body: "Venue confirmed the hall", occurred_at: "2026-11-06T08:00:01.900Z", created_at: "2026-11-06T08:00:01.900Z" });
    const list = items([f], [note, call], "2026-11-06T08:00:01.900Z");
    expect(completed(list)).toHaveLength(1);
    expect(list.find((i) => i.id === "fd-f1")).toMatchObject({ label: "Call", firstResponse: true, internal: false, mergedRows: 3 });
    expect(list.map((i) => i.id).sort()).toEqual(["fd-f1", "fp-f1"]);
  });
  it("genuinely distinct entries stay: different words, a different person, or a different time", () => {
    const f = followUp();
    const otherWords = activity({ id: "x1", body: "Follow-up done: Call the venue. They also want a second screen" });
    const otherPerson = activity({ id: "x2", body: completionNoteBody(f), created_by: "u1" });
    const later = activity({ id: "x3", body: completionNoteBody(f), occurred_at: "2026-11-06T09:30:00Z" });
    const sameWordsNextDay = activity({ id: "x4", kind: "call", body: "Venue confirmed the hall", occurred_at: "2026-11-07T08:00:00Z" });
    const list = items([f], [otherWords, otherPerson, later, sameWordsNextDay]);
    expect(list.map((i) => i.id).sort()).toEqual(["a-x1", "a-x2", "a-x3", "a-x4", "fd-f1", "fp-f1"]);
    expect(list.find((i) => i.id === "fd-f1")!.mergedRows).toBeUndefined();
  });
  it("two follow-ups with the same title and outcome each take their own note, and a note is never used twice", () => {
    const a = followUp({ id: "fa", completed_at: "2026-11-06T08:00:00Z" });
    const b = followUp({ id: "fb", completed_at: "2026-11-06T08:00:03Z" });
    const m = matchCompletions([a, b], [activity({ id: "n1", body: completionNoteBody(a), occurred_at: "2026-11-06T08:00:00Z" }), activity({ id: "n2", body: completionNoteBody(b), occurred_at: "2026-11-06T08:00:03Z" })]);
    expect(m.get("fa")!.note!.id).toBe("n1");
    expect(m.get("fb")!.note!.id).toBe("n2");
    const one = matchCompletions([a, b], [activity({ id: "n1", body: completionNoteBody(a), occurred_at: "2026-11-06T08:00:00Z" })]);
    expect([one.get("fa")!.note?.id, one.get("fb")!.note?.id]).toEqual(["n1", undefined]);
  });
  it("an open or cancelled follow-up folds nothing in", () => {
    const open = followUp({ status: "open", completed_at: null, completed_by: null, outcome: null });
    const note = activity({ id: "n1", body: "Follow-up done: Call the venue. " });
    expect(items([open], [note]).map((i) => i.id).sort()).toEqual(["a-n1", "fp-f1"]);
  });
});
