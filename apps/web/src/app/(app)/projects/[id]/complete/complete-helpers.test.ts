import { describe, expect, it } from "vitest";
import type { ProjCompletionReviewRow } from "@/types/projects";
import { applyToKind, buildResolutions, evidenceProblems, itemKey, unresolvedItems, type EvidenceInput } from "./complete-helpers";

const items: ProjCompletionReviewRow[] = [
  { kind: "task", item_id: "t1", title: "Wire sensors", status: "in_progress", detail: "Sam · Blocked: truss" },
  { kind: "task", item_id: "t2", title: "Polish", status: "todo", detail: null },
  { kind: "feedback", item_id: "f1", title: "Brighter glow", status: "open", detail: "Client" },
  { kind: "booking", item_id: "b1", title: "Site: Hall 3", status: "tentative", detail: "Sam" },
];

describe("completion decisions", () => {
  it("lists everything as unresolved until each item has a valid action and a reason", () => {
    expect(unresolvedItems(items, {})).toHaveLength(4);
    const partial = { [itemKey(items[0]!)]: { action: "cancel", note: "Dropped" } };
    expect(unresolvedItems(items, partial).map((i) => i.item_id)).toEqual(["t2", "f1", "b1"]);
  });
  it("does not count an action without a reason, or an action not allowed for that kind", () => {
    const choices = {
      [itemKey(items[0]!)]: { action: "cancel", note: "   " },
      [itemKey(items[1]!)]: { action: "resolve", note: "tasks cannot be resolved" },
      [itemKey(items[2]!)]: { action: "done", note: "never Done" },
      [itemKey(items[3]!)]: { action: "defer", note: "bookings can only be cancelled" },
    };
    expect(unresolvedItems(items, choices)).toHaveLength(4);
    expect(buildResolutions(items, choices)).toEqual([]);
  });
  it("builds the payload in review order with trimmed reasons", () => {
    const choices = {
      [itemKey(items[3]!)]: { action: "cancel", note: " Show cancelled " },
      [itemKey(items[0]!)]: { action: "defer", note: "Next phase" },
      [itemKey(items[1]!)]: { action: "cancel", note: "Not needed" },
      [itemKey(items[2]!)]: { action: "decline", note: "Out of scope" },
    };
    expect(unresolvedItems(items, choices)).toEqual([]);
    expect(buildResolutions(items, choices)).toEqual([
      { kind: "task", id: "t1", action: "defer", note: "Next phase" },
      { kind: "task", id: "t2", action: "cancel", note: "Not needed" },
      { kind: "feedback", id: "f1", action: "decline", note: "Out of scope" },
      { kind: "booking", id: "b1", action: "cancel", note: "Show cancelled" },
    ]);
  });
  it("applies one decision to a whole kind, skipping an action the kind does not allow", () => {
    const next = applyToKind(items, {}, "task", { action: "defer", note: "Phase 2" });
    expect(unresolvedItems(items, next).map((i) => i.kind)).toEqual(["feedback", "booking"]);
    expect(applyToKind(items, {}, "task", { action: "resolve", note: "x" })).toEqual({});
  });
});

describe("completion evidence", () => {
  const base: EvidenceInput = { projectKind: "client", evidenceType: "email_reference", evidenceReference: "Mail 14 Apr", fileId: "", confirmedOn: "2026-04-14", clientContact: "Sara", note: "Signed off", today: "2026-04-18" };
  it("accepts complete client evidence", () => expect(evidenceProblems(base)).toEqual([]));
  it("asks for each missing piece of client evidence", () => {
    expect(evidenceProblems({ ...base, evidenceType: "" })).toContain("Choose the kind of client confirmation.");
    expect(evidenceProblems({ ...base, evidenceReference: " " })).toContain("Give the reference of the client's confirmation.");
    expect(evidenceProblems({ ...base, clientContact: "" })).toContain("Record who at the client confirmed.");
    expect(evidenceProblems({ ...base, note: "" })).toContain("Write the completion note.");
    expect(evidenceProblems({ ...base, confirmedOn: "" })).toContain("Give the date the client confirmed.");
  });
  it("refuses a future confirmation date, and needs a file for an uploaded confirmation", () => {
    expect(evidenceProblems({ ...base, confirmedOn: "2026-04-19" })).toContain("The confirmation date cannot be in the future.");
    expect(evidenceProblems({ ...base, evidenceType: "uploaded_confirmation" })).toContain("Choose the uploaded confirmation file.");
    expect(evidenceProblems({ ...base, evidenceType: "uploaded_confirmation", fileId: "f" })).toEqual([]);
  });
  it("asks an internal project only for the owner's note", () => {
    expect(evidenceProblems({ ...base, projectKind: "internal", evidenceType: "", evidenceReference: "", confirmedOn: "", clientContact: "" })).toEqual([]);
    expect(evidenceProblems({ ...base, projectKind: "internal", note: "" })).toEqual(["Write the completion note."]);
  });
});
