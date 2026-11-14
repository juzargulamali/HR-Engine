import { describe, expect, it } from "vitest";
import {
  pickAttention, feedbackLinks, reviewStateWord,
  toLocalInput, activityWhen, attentionHref, filterRegister, formatAt, groupByActivation, nextOutputAction, parseRegisterFilter, quantityText, recentText, needsViewer, registerCounts, registerCsv, resolveZone, runGroups, siteRange,
  type Register, type RegisterRow, type SiteActivity, type OutputVersion,
} from "./model";

const ver = (o: Partial<OutputVersion> = {}): OutputVersion => ({ id: "v", version_no: 1, status: "awaiting", item_count: 1, mutable_link: false, note: null, submitted_by: "u", submitted_by_name: "Fictional Cara", attached_at: "2027-11-10T06:05:00Z",
  decided_at: null, decided_by_name: null, decision_note: null, approved_at: null, approved_by_name: null, file: { id: "f", accessible: true, kind: "link", name: "Storyboard v1", url: "https://docs.example.com/s1" }, snapshot: null, feedback: [], ...o });
const row = (o: Partial<RegisterRow> = {}): RegisterRow => ({ task_id: "t", task_title: "Storyboard", task_status: "in_progress", task_due: null, blocked: false, requires_review: true, team_id: null, assignee_id: "u", assignee_name: "Fictional Cara", output_label: "Storyboard", output_qty: 1,
  output_required: true, activation: { id: "a", key: "D001", title: "Welcome wall" }, milestone: null, state: "missing", versions_count: 0, current: null, versions: [], ...o });

describe("time zones: a time is never shown without its zone", () => {
  it("shows the project's zone, and says so plainly when it has none or an unknown one", () => {
    expect(formatAt("2027-11-10T06:05:00Z", "Asia/Dubai")).toBe("10 Nov 2027, 10:05 Asia/Dubai");
    expect(formatAt("2027-11-10T06:05:00Z", "America/New_York")).toBe("10 Nov 2027, 01:05 America/New York");
    expect(formatAt("2027-11-10T06:05:00Z", null)).toBe("10 Nov 2027, 06:05 UTC (project time zone not set)");
    expect(formatAt("2027-11-10T06:05:00Z", "Not/AZone")).toBe("10 Nov 2027, 06:05 UTC (project time zone not set)");
    expect(formatAt(null, "Asia/Dubai")).toBe("—");
    expect(resolveZone("Europe/Warsaw")).toEqual({ zone: "Europe/Warsaw", fellBack: false });
    expect(resolveZone("")).toEqual({ zone: "UTC", fellBack: true });
  });
});

describe("local input values", () => {
  it("gives the value a datetime-local box needs, in the chosen zone", () => {
    expect(toLocalInput("2027-11-11T05:00:00Z", "Asia/Dubai")).toBe("2027-11-11T09:00");
    expect(toLocalInput("2027-11-09T02:30:00Z", "Asia/Kolkata")).toBe("2027-11-09T08:00");
    expect(toLocalInput(null, "Asia/Dubai")).toBe("");
  });
});

describe("register", () => {
  const rows = [row({ task_id: "1", state: "missing" }), row({ task_id: "2", state: "partial" }), row({ task_id: "3", state: "awaiting_review" }), row({ task_id: "4", state: "changes_requested" }), row({ task_id: "5", state: "approved" }),
    row({ task_id: "6", state: "missing", activation: null })];
  it("filters Missing (including incomplete), Awaiting review, Changes requested and Approved, and counts them", () => {
    expect(filterRegister(rows, "missing").map((r) => r.task_id)).toEqual(["1", "2", "6"]);
    expect(filterRegister(rows, "awaiting").map((r) => r.task_id)).toEqual(["3"]);
    expect(filterRegister(rows, "changes").map((r) => r.task_id)).toEqual(["4"]);
    expect(filterRegister(rows, "approved").map((r) => r.task_id)).toEqual(["5"]);
    expect(filterRegister(rows, "all")).toHaveLength(6);
    expect(registerCounts(rows)).toEqual({ all: 6, next: 0, missing: 3, awaiting: 1, changes: 1, approved: 1 });
    expect(parseRegisterFilter("changes")).toBe("changes"); expect(parseRegisterFilter("bogus")).toBe("all"); expect(parseRegisterFilter(undefined)).toBe("all");
  });
  it("Do next is only what THIS reader must act on: a version they may decide, name a reviewer for or send on, and their own missing, short or sent-back outputs", () => {
    const awaiting = (o: Partial<OutputVersion>) => row({ task_id: "w", state: "awaiting_review", current: ver({ status: "awaiting", ...o }) });
    expect(needsViewer(awaiting({ can_decide: true }), "me")).toBe(true);
    expect(needsViewer(awaiting({ can_assign: true }), "me")).toBe(true);
    expect(needsViewer(awaiting({ can_reroute: true }), "me")).toBe(true);
    expect(needsViewer(awaiting({}), "me")).toBe(false);
    expect(needsViewer(row({ state: "changes_requested", assignee_id: "me" }), "me")).toBe(true);
    expect(needsViewer(row({ state: "changes_requested", assignee_id: "other" }), "me")).toBe(false);
    expect(needsViewer(row({ state: "missing", assignee_id: "me" }), "me")).toBe(true);
    expect(needsViewer(row({ state: "approved", assignee_id: "me" }), "me")).toBe(false);
    const all = [awaiting({ can_decide: true }), row({ task_id: "m", state: "missing", assignee_id: "me" }), row({ task_id: "x", state: "missing", assignee_id: "other" })];
    expect(filterRegister(all, "next", "me").map((r) => r.task_id)).toEqual(["w", "m"]);
    expect(filterRegister(all, "next").map((r) => r.task_id)).toEqual(["w"]); // without a person, only what the database says this reader may decide
    expect(registerCounts(all, "me").next).toBe(2);
    expect(parseRegisterFilter("next")).toBe("next");
  });
  it("groups by activation with the rows that belong to none last", () => {
    const g = groupByActivation([row({ task_id: "a", activation: { id: "2", key: "D002", title: "B" } }), row({ task_id: "n", activation: null }), row({ task_id: "b", activation: { id: "1", key: "D001", title: "A" } })]);
    expect(g.map((x) => x.title)).toEqual(["D001 · A", "D002 · B", "Not part of an activation"]);
  });
  it("says what is expected against what was provided, and who acts next, in words", () => {
    expect(quantityText({ output_qty: 3 }, ver({ item_count: 2 }))).toBe("2 of 3 provided");
    expect(quantityText({ output_qty: 1 }, ver({ item_count: 1 }))).toBeNull();
    expect(quantityText({ output_qty: 3 }, null)).toBe("3 expected");
    expect(nextOutputAction(row({ state: "missing" }), { isAssignee: true, isReviewer: false })).toMatch(/Add the expected output: Storyboard\. The task cannot be sent for review/);
    expect(nextOutputAction(row({ state: "missing" }), { isAssignee: false, isReviewer: true })).toBe("Waiting for Fictional Cara to add Storyboard.");
    expect(nextOutputAction(row({ state: "awaiting_review", current: ver({ version_no: 2 }) }), { isAssignee: false, isReviewer: true })).toBe("Version 2 is waiting for your review.");
    expect(nextOutputAction(row({ state: "changes_requested", current: ver({ version_no: 1, decision_note: "Too dark" }) }), { isAssignee: true, isReviewer: false })).toBe("Changes were requested on version 1: Too dark. Submit a new version.");
  });
  it("exports only what the register returned: a restricted file has no name, address or size in the CSV", () => {
    const reg: Register = { tz: "Asia/Dubai", rows: [
      row({ state: "approved", current: ver({ version_no: 2, status: "approved", approved_at: "2027-11-11T08:00:00Z", approved_by_name: "Fictional Eli", decision_note: 'Good, "ship it"', mutable_link: true }) }),
      row({ task_id: "x", task_title: "Secret pack", output_label: "Quote pack", state: "awaiting_review", current: ver({ file: { id: null, accessible: false, restricted: true } }) })] };
    const csv = registerCsv(reg);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Activation,Task,Deliverable/);
    expect(lines[1]).toContain("11 Nov 2027, 12:00 Asia/Dubai");
    expect(lines[1]).toContain('"Good, ""ship it"""');
    expect(lines[1]).toContain("https://docs.example.com/s1");
    expect(lines[2]).toContain("Restricted file (the Project Manager can open it)");
    expect(lines[2]).not.toContain("https://");
  });
});

const act = (o: Partial<SiteActivity> = {}): SiteActivity => ({ id: "a", title: "Setup", kind: "setup", run_label: "Run 1", location: "Hall 3", status: "planned", owner_id: null, owner_name: null, state: "tentative", confirmed_at: null, start_date: null, end_date: null,
  starts_at: null, ends_at: null, tz: null, notes: null, version: 1, milestone_id: null, client_facing: false, crew: [], missing: [], ...o });

describe("site schedule", () => {
  it("writes exact dates and times: timed in the activity's zone, date-only with 'time to confirm', ranges across a month, none", () => {
    expect(activityWhen(act({ starts_at: "2027-11-11T05:00:00Z", ends_at: "2027-11-11T14:00:00Z", tz: "Asia/Dubai" }), "Asia/Dubai")).toBe("11 Nov, 09:00–18:00 Asia/Dubai");
    expect(activityWhen(act({ start_date: "2027-11-13", end_date: "2027-11-13" }), "Asia/Dubai")).toBe("13 Nov (time to confirm)");
    expect(activityWhen(act({ start_date: "2027-11-14", end_date: "2027-11-15" }), "Asia/Dubai")).toBe("14–15 Nov (time to confirm)");
    expect(activityWhen(act({ start_date: "2027-11-29", end_date: "2027-12-02" }), "Asia/Dubai")).toBe("29 Nov – 2 Dec (time to confirm)");
    expect(activityWhen(act({ starts_at: "2027-11-12T16:00:00Z", ends_at: "2027-11-12T19:30:00Z", tz: "Asia/Dubai" }), null)).toBe("12 Nov, 20:00–23:30 Asia/Dubai");
    expect(activityWhen(act(), "Asia/Dubai")).toBe("No date");
    expect(activityWhen(act({ starts_at: "2027-11-11T05:00:00Z", ends_at: "2027-11-11T14:00:00Z" }), null)).toBe("11 Nov, 05:00–14:00 UTC (project time zone not set)");
  });
  it("keeps two runs as two runs, so nothing implies the equipment stays installed between them", () => {
    const g = runGroups([act({ id: "1", run_label: "Run 1" }), act({ id: "2", run_label: "Run 1" }), act({ id: "3", run_label: "Run 2" }), act({ id: "4", run_label: null })]);
    expect(g.map((x) => [x.run, x.activities.length])).toEqual([["Run 1", 2], ["Run 2", 1], ["Other activities", 1]]);
  });
  it("finds the day range of everything dated, in each item's own zone", () => {
    const r = siteRange({ tz: "Asia/Dubai", activities: [act({ start_date: "2027-11-14", end_date: "2027-11-15" }), act({ starts_at: "2027-11-11T05:00:00Z", ends_at: "2027-11-11T14:00:00Z" })],
      shipments: [{ id: "s", label: "x", plan_item_id: null, activity_title: null, carrier: null, reference: null, notes: null, state: "tentative", version: 1, departs_at: "2027-11-09T02:30:00Z", departs_tz: "Asia/Kolkata", arrives_at: null, arrives_tz: null, returns_at: null, returns_tz: null, request: null, missing: [], conflict: null }] });
    expect(r).toEqual({ start: "2027-11-09", end: "2027-11-15" });
    expect(siteRange({ tz: null, activities: [], shipments: [] })).toBeNull();
  });
});

describe("Work overview text and links", () => {
  it("links each attention line to the record that fixes it, and words recent changes plainly", () => {
    expect(attentionHref("p1", { kind: "output_missing", task_id: "t1", title: "", detail: "", who: [] })).toBe("/projects/p1/work?task=t1");
    expect(attentionHref("p1", { kind: "site_missing", activity_id: "a1", title: "", detail: "", who: [] })).toBe("/projects/p1/plan?plan=site&mode=list#site-a1");
    expect(attentionHref("p1", { kind: "shipment_conflict", shipment_id: "s1", title: "", detail: "", who: [] })).toBe("/projects/p1/plan?plan=site&mode=list#ship-s1");
    const r = (o: object) => ({ at: "2027-11-10T06:05:00Z", actor: "Fictional Eli", entity: "task_output", entity_id: "e", field: "version", from: null, to: "v2", note: null, title: "Storyboard", ...o }) as never;
    expect(recentText(r({}))).toBe("Fictional Eli submitted v2 of Storyboard");
    expect(recentText(r({ field: "review of v2", to: "approved" }))).toBe("Fictional Eli approved v2 of Storyboard");
    expect(recentText(r({ field: "review of v1", to: "changes_requested" }))).toBe("Fictional Eli asked for changes on v1 of Storyboard");
    expect(recentText(r({ entity: "site_activity", field: "state", to: "confirmed", title: "Show (run 2)" }))).toBe("Fictional Eli confirmed Show (run 2)");
    expect(recentText(r({ entity: "shipment", field: "arrival", title: "Crates" }))).toBe("Fictional Eli changed the arrival of Crates");
  });
});

describe("pickAttention", () => {
  const line = (kind: "output_missing" | "shipment_conflict", n: number) => ({ kind, title: `${kind}-${n}`, detail: "", who: [] });
  it("keeps a late shipment visible behind many missing outputs, and counts what it left out", () => {
    const all = [1, 2, 3, 4, 5, 6, 7].map((n) => line("output_missing", n)).concat([line("shipment_conflict", 1)]);
    const { shown, more } = pickAttention(all);
    expect(shown.map((a) => a.title)).toEqual(["output_missing-1", "output_missing-2", "shipment_conflict-1"]);
    expect(more).toBe(5);
  });
});

describe("feedbackLinks", () => {
  const look = { items: new Map([["a1", { key: "D001", title: "Batak wall", removed: false }], ["a2", { key: "D002", title: "Old idea", removed: true }]]), versions: new Map([["v1", { task_id: "t1", version_no: 2 }]]), tasks: new Map([["t1", "Storyboard"]]) };
  it("links a live activation and a version", () => {
    const r = feedbackLinks({ activation_id: "a1", output_version_id: "v1" }, "p1", look);
    expect(r.activation).toEqual({ text: "D001 Batak wall", href: "/projects/p1/delivery?open=D001#dp-D001" });
    expect(r.version).toEqual({ text: "Version 2 of Storyboard", href: "/projects/p1/work?task=t1&version=v1" });
  });
  it("says Activation removed, with no link, when the activation was removed or is gone", () => {
    expect(feedbackLinks({ activation_id: "a2" }, "p1", look).activation).toEqual({ text: "Activation removed", href: null });
    expect(feedbackLinks({ activation_id: "missing" }, "p1", look).activation).toEqual({ text: "Activation removed", href: null });
    expect(feedbackLinks({ output_version_id: "gone" }, "p1", look).version).toEqual({ text: "Version no longer available", href: null });
    expect(feedbackLinks({}, "p1", look)).toEqual({ activation: null, version: null });
  });
});

describe("reviewStateWord", () => {
  it("names the Operations reviewer, or says one is needed", () => {
    expect(reviewStateWord({ status: "awaiting", route: "operations", reviewer_name: "Lena", needs_reviewer: false })).toBe("Awaiting Operations review · Lena");
    expect(reviewStateWord({ status: "awaiting", route: "operations", reviewer_name: null, needs_reviewer: false })).toBe("Awaiting Operations review");
    expect(reviewStateWord({ status: "awaiting", route: "operations", reviewer_name: null, needs_reviewer: true })).toBe("Needs an Operations reviewer");
    expect(reviewStateWord({ status: "awaiting", route: "team", reviewer_name: null, needs_reviewer: false })).toBe("Awaiting review");
    expect(reviewStateWord({ status: "approved", route: "operations", reviewer_name: "Lena", needs_reviewer: false })).toBe("Approved");
  });
});
