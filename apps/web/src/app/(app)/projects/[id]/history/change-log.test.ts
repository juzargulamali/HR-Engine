import { describe, expect, it } from "vitest";
import { describeChange, type ChangeContext, type ChangeRow } from "./change-log";

const ctx: ChangeContext = {
  entityName: (t, id) => (t === "milestone" && id === "m1" ? "Final render" : null),
  nameOf: (id) => (id === "u1" ? "Amira" : "Someone"),
};
const row = (over: Partial<ChangeRow>): ChangeRow => ({ entity_type: "project", entity_id: "p", field: "status", from_value: null, to_value: null, note: null, actor_id: null, ...over });

describe("describeChange", () => {
  it("renders status changes with labels, not codes", () => {
    expect(describeChange(row({ from_value: "in_progress", to_value: "ready_for_installation" }), ctx).sentence).toBe("The status changed from In progress to Ready for installation.");
    expect(describeChange(row({ entity_type: "milestone", entity_id: "m1", from_value: "planned", to_value: "accepted" }), ctx)).toEqual({ subject: "Milestone: Final render", sentence: "The status changed from Planned to Accepted." });
  });
  it("renders date changes as dates and a cleared date as not set, with no time zone shift", () => {
    expect(describeChange(row({ field: "end_date", from_value: "2099-04-01", to_value: "2099-04-08" }), ctx).sentence).toBe("The end date changed from 1 Apr 2099 to 8 Apr 2099.");
    expect(describeChange(row({ entity_type: "milestone", entity_id: "m1", field: "due_date", from_value: "2099-03-29", to_value: null }), ctx).sentence).toBe("The due date changed from 29 Mar 2099 to not set.");
  });
  it("names people for membership and temporary leadership", () => {
    expect(describeChange(row({ entity_type: "member", entity_id: "u1", field: "added", to_value: "Amira" }), ctx).sentence).toBe("Amira was added to the project.");
    expect(describeChange(row({ entity_type: "member", entity_id: "u1", field: "removed" }), ctx).sentence).toBe("Amira was removed from the project.");
    expect(describeChange(row({ entity_type: "member", entity_id: "u1", field: "acting_pm_until", to_value: "2099-05-02" }), ctx).sentence).toBe("Amira was given temporary project leadership until 2 May 2099.");
    expect(describeChange(row({ entity_type: "member", entity_id: "u1", field: "acting_pm_until", from_value: "set" }), ctx).sentence).toBe("Temporary project leadership of Amira ended.");
  });
  it("reports PM changes by name", () => {
    expect(describeChange(row({ field: "pm", from_value: "Omar", to_value: "Lena" }), ctx).sentence).toBe("The Project Manager changed from Omar to Lena.");
  });
  it("never shows ids or booking times, and describes a scope change in words", () => {
    const scope = describeChange(row({ field: "scope", from_value: "previous scope kept in change 123", to_value: "approved change 123" }), ctx).sentence;
    expect(scope).not.toContain("123");
    expect(describeChange(row({ entity_type: "booking", field: "window", from_value: "2099-06-10 05:00:00+00 - x", to_value: "y" }), ctx).sentence).toBe("The booking time was changed.");
  });
  it("describes deleted discussion messages without their text", () => {
    expect(describeChange(row({ entity_type: "message", field: "deleted", from_value: "Amira", to_value: "Omar" }), ctx).sentence).toBe("A message by Amira was deleted by Omar.");
  });
  it("handles plan item times and booking state", () => {
    expect(describeChange(row({ entity_type: "plan_item", field: "start", from_value: "2099-03-01 08:00:00+00", to_value: "2099-03-02 08:00:00+00" }), ctx).sentence).toBe("The start time was changed.");
    expect(describeChange(row({ entity_type: "booking", field: "state", from_value: "tentative", to_value: "confirmed" }), ctx).sentence).toBe("The status changed from Tentative to Confirmed.");
  });
  it("falls back to a readable sentence for an unknown field", () => {
    expect(describeChange(row({ field: "some_new_field", from_value: "a", to_value: "b" }), ctx).sentence).toBe("The some new field changed from a to b.");
  });
});
