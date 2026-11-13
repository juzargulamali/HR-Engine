import { describe, expect, it } from "vitest";
import { milestoneSummary, outputSummary } from "./work-summary";
import type { Register } from "@/lib/projects/phase2/model";

const m = (id: string, status: string, due: string | null) => ({ id, title: `M ${id}`, status, due_date: due, is_required: true });
describe("work summary", () => {
  it("counts milestones and names the next open one, ignoring cancelled ones", () => {
    const s = milestoneSummary([m("a", "accepted", "2027-01-01"), m("b", "planned", "2027-03-01"), m("c", "in_progress", "2027-02-01"), m("d", "cancelled", "2027-01-15")], "2027-02-10");
    expect(s).toMatchObject({ total: 3, accepted: 1, open: 2, overdue: 1, next: { id: "c", due: "2027-02-01" } });
  });
  it("says nothing is open when every milestone is accepted, and handles none", () => {
    expect(milestoneSummary([m("a", "accepted", null)], "2027-01-01").next).toBeNull();
    expect(milestoneSummary([], "2027-01-01")).toMatchObject({ total: 0, next: null });
  });
  it("summarises task outputs by state, or says it could not (null)", () => {
    const row = (state: string) => ({ state }) as never;
    const reg = { tz: null, rows: [row("missing"), row("partial"), row("awaiting_review"), row("changes_requested"), row("approved"), row("approved")] } as Register;
    expect(outputSummary(reg)).toMatchObject({ total: 6, counts: { missing: 2, awaiting: 1, changes: 1, approved: 2 } });
    expect(outputSummary(null)).toBeNull();
  });
});
