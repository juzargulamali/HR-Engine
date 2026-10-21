import { describe, expect, it } from "vitest";
import { boardColumnFor, boardColumns, boardMoveKind, boardMoveTargets, installOrShowDate, sortEnquiries, type EnquirySortKey } from "./enquiry-list";
import type { OpportunityListItem } from "./data";

const item = (id: string, over: Partial<OpportunityListItem["opp"]> & { value?: number | null; due?: string | null; owner?: string; agency?: string | null; client?: string | null } = {}): OpportunityListItem =>
  ({
    opp: {
      id, reference: `OPP-${id}`, title: over.title ?? `Enquiry ${id}`, stage: over.stage ?? "new", currency: over.currency ?? "AED",
      install_start: over.install_start ?? null, event_start: over.event_start ?? null, created_at: over.created_at ?? "2026-01-01T00:00:00Z",
    },
    value: over.value ?? null,
    ownerName: over.owner ?? "Ann",
    agency: over.agency ? { name: over.agency } : null,
    client: over.client ? { name: over.client } : null,
    nextFollowUp: over.due ? { due_at: over.due } : null,
    openFollowUps: 0, companyName: "Co", availability: "unverified",
  }) as unknown as OpportunityListItem;

const ids = (xs: OpportunityListItem[]) => xs.map((x) => x.opp.id);
const sort = (xs: OpportunityListItem[], key: EnquirySortKey, dir: "asc" | "desc" = "asc") => ids(sortEnquiries(xs, { key, dir }));

describe("sortEnquiries", () => {
  const a = item("a", { title: "Zebra wall", due: "2026-05-02T08:00:00Z", owner: "Bo", stage: "qualified", install_start: "2026-06-01", agency: "Zeta" });
  const b = item("b", { title: "Apple tunnel", due: "2026-05-01T08:00:00Z", owner: "Al", stage: "new", event_start: "2026-05-20", client: "Acme" });
  const c = item("c", { title: "Mid", due: null, owner: "Cy", stage: "negotiation" });
  it("sorts by next action due with missing last in both directions", () => {
    expect(sort([a, b, c], "due")).toEqual(["b", "a", "c"]);
    expect(sort([a, b, c], "due", "desc")).toEqual(["a", "b", "c"]);
  });
  it("sorts by title, owner, party and stage order", () => {
    expect(sort([a, b, c], "enquiry")).toEqual(["b", "c", "a"]);
    expect(sort([a, b, c], "owner")).toEqual(["b", "a", "c"]);
    expect(sort([a, b, c], "party")).toEqual(["b", "a", "c"]);          // Acme, Zeta, then none
    expect(sort([a, b, c], "stage")).toEqual(["b", "a", "c"]);          // new, qualified, negotiation
  });
  it("sorts by installation, falling back to the show start", () => {
    expect(installOrShowDate({ install_start: "2026-06-01", event_start: "2026-05-20" })).toBe("2026-06-01");
    expect(installOrShowDate({ install_start: null, event_start: "2026-05-20" })).toBe("2026-05-20");
    expect(sort([a, b, c], "dates")).toEqual(["b", "a", "c"]);
  });
  it("never compares amounts across currencies, and puts unvalued records last", () => {
    const v1 = item("v1", { value: 900, currency: "AED" });
    const v2 = item("v2", { value: 100, currency: "EUR" });
    const v3 = item("v3", { value: 50, currency: "AED" });
    const v4 = item("v4", { value: null });
    expect(sort([v2, v1, v4, v3], "value")).toEqual(["v3", "v1", "v2", "v4"]);
    expect(sort([v2, v1, v4, v3], "value", "desc")).toEqual(["v1", "v3", "v2", "v4"]);
  });
  it("does not change the input", () => {
    const input = [a, b, c];
    sortEnquiries(input, { key: "enquiry", dir: "asc" });
    expect(ids(input)).toEqual(["a", "b", "c"]);
  });
});

describe("board", () => {
  it("has the pipeline stages, then on hold, then won and lost", () => {
    expect(boardColumns().map((c) => c.id)).toEqual(["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
    expect(boardColumnFor("on_hold")).toBe("on_hold");
    expect(boardColumnFor("mystery")).toBe("new");
  });
  it("tells a plain move from one that needs a form", () => {
    expect(boardMoveKind("new", "qualified")).toBe("stage");
    expect(boardMoveKind("new", "on_hold")).toBe("hold");
    expect(boardMoveKind("negotiation", "won")).toBe("won");
    expect(boardMoveKind("negotiation", "lost")).toBe("lost");
    expect(boardMoveKind("on_hold", "qualified")).toBe("resume");
    expect(boardMoveKind("on_hold", "lost")).toBe("lost");
  });
  const base = { stageBeforeHold: null, canEdit: true, ownerName: "Ann" };
  it("offers a working card one step back or any step forward, hold, won and lost", () => {
    expect(boardMoveTargets({ ...base, stage: "qualified" }).moveTo).toEqual(["new", "proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
    expect(boardMoveTargets({ ...base, stage: "new" }).moveTo).toEqual(["qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
  });
  it("lets a held card resume into the stage it came from or be lost, never won", () => {
    expect(boardMoveTargets({ ...base, stage: "on_hold", stageBeforeHold: "quote_sent" }).moveTo).toEqual(["quote_sent", "lost"]);
    expect(boardMoveTargets({ ...base, stage: "on_hold", stageBeforeHold: null }).moveTo).toEqual(["lost"]);
    expect(boardMoveTargets({ ...base, stage: "on_hold", stageBeforeHold: "won" }).moveTo).toEqual(["lost"]);
  });
  it("offers nothing for a closed card or to someone who may not edit, and says why", () => {
    const closed = boardMoveTargets({ ...base, stage: "won" });
    expect(closed.moveTo).toEqual([]);
    expect(closed.lockedReason).toMatch(/reopen/i);
    const other = boardMoveTargets({ ...base, stage: "new", canEdit: false, ownerName: "Bo" });
    expect(other.moveTo).toEqual([]);
    expect(other.lockedReason).toContain("Bo");
  });
});
