import { describe, expect, it } from "vitest";
import { failing, fakeSupabase, rows } from "@/test/fake-supabase";
import { loadLeadCandidates } from "./lead-candidates";

const asClient = (c: ReturnType<typeof fakeSupabase>) => c as never;

describe("loadLeadCandidates", () => {
  it("maps the database's id and display name to picker options", async () => {
    const db = fakeSupabase({}, { attendance_lead_candidates: rows([{ employee_id: "e1", display_name: "Leo Lead" }, { employee_id: "e2", display_name: "Pia Peer" }]) });
    expect(await loadLeadCandidates(asClient(db))).toEqual({ leads: [{ id: "e1", name: "Leo Lead" }, { id: "e2", name: "Pia Peer" }], failed: false });
  });

  it("an empty successful answer is an empty list, not a failure", async () => {
    expect(await loadLeadCandidates(asClient(fakeSupabase({}, { attendance_lead_candidates: rows([]) })))).toEqual({ leads: [], failed: false });
  });

  it("a failed read is reported as failed, never as an empty list that looks complete", async () => {
    expect(await loadLeadCandidates(asClient(fakeSupabase({}, { attendance_lead_candidates: failing() })))).toEqual({ leads: [], failed: true });
  });
});
