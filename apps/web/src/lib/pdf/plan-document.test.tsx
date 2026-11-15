// @vitest-environment node
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import type { IssuedPlanPayload } from "@enginious-hr/domain";

vi.mock("server-only", () => ({}));

const payload: IssuedPlanPayload = {
  project: { reference: "UAE-P-2026-0001", name: "Floor projection", client_name: "Orbit Motors", location: "Expo Hall 3", site_timezone: "Asia/Dubai" },
  milestones: [{ title: "First draft", due_date: "2099-03-01" }],
  delivery: [{ title: "Moodboard", start_date: "2099-02-01", end_date: "2099-02-03" }],
  site: [{ title: "Installation", start_date: null, end_date: null, starts_local: "2099-03-05T08:00", ends_local: "2099-03-07T18:00", tz: "Asia/Dubai" }],
  dependencies: [{ label: "Power drop ready", kind: "power_network", expected_date: "2099-03-04", expected_time: "09:00:00", organisation: "Expo Builders LLC", confirmation: "pending" }],
};

describe("client timeline PDF", () => {
  it("renders a real PDF from the issued payload alone", async () => {
    const { PlanDocument } = await import("./plan-document");
    const buf = await renderToBuffer(createElement(PlanDocument, { payload, version: 2, clientReference: "UAE-P-2026-0001", title: "Floor projection", tz: "Asia/Dubai", issuedAt: "2099-03-01T08:00:00Z" }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(2000);
  });
  it("a version issued with tasks renders them from the allowlisted fields only: a field that is not on the allowlist is never read into the table or the PDF", async () => {
    const { planTableRows } = await import("@enginious-hr/domain");
    const { groupPlanRows } = await import("./plan-layout");
    const { PlanDocument } = await import("./plan-document");
    // Even if a payload somehow carried more (the database never builds one that does), the readable form takes the title, the dates and the status and nothing else.
    const withTasks = { ...payload, tasks: [
      { title: "Screen content ready", start_date: "2099-03-01", due_date: "2099-03-05", status: "In progress", description: "SECRET-DESCRIPTION", assignee: "SECRET-ASSIGNEE", blocked_reason: "SECRET-BLOCKED", cost: "SECRET-COST" },
      { title: "Stand graphics approved", start_date: null, due_date: "2099-03-07", status: "Planned" },
      { title: "Final checks", start_date: null, due_date: null, status: "Done" },
    ] } as unknown as IssuedPlanPayload;
    const rows = planTableRows(withTasks);
    expect(rows.filter((r) => r.section === "Tasks")).toEqual([
      { section: "Tasks", title: "Screen content ready", when: "1 Mar 2099 to 5 Mar 2099", detail: "In progress" },
      { section: "Tasks", title: "Stand graphics approved", when: "Due 7 Mar 2099", detail: "Planned" },
      { section: "Tasks", title: "Final checks", when: "Date to be confirmed", detail: "Done" },
    ]);
    expect(JSON.stringify(rows)).not.toContain("SECRET");
    expect(groupPlanRows(rows).map((x) => x.title)).toEqual(["Milestones", "Tasks", "Delivery timeline", "Site production timeline", "Dependencies on others"]);
    const buf = await renderToBuffer(createElement(PlanDocument, { payload: withTasks, version: 3, clientReference: "UAE-P-2026-0001", title: "Floor projection", tz: "Asia/Dubai", issuedAt: "2099-03-01T08:00:00Z" }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.toString("latin1")).not.toContain("SECRET");
  });
  it("a version issued before tasks could be chosen (no tasks key) still renders exactly its own sections", async () => {
    const { planTableRows } = await import("@enginious-hr/domain");
    const { groupPlanRows } = await import("./plan-layout");
    expect("tasks" in payload).toBe(false);
    expect(groupPlanRows(planTableRows(payload)).map((x) => x.title)).toEqual(["Milestones", "Delivery timeline", "Site production timeline", "Dependencies on others"]);
  });
  it("renders an empty version without failing", async () => {
    const { PlanDocument } = await import("./plan-document");
    const empty = { ...payload, milestones: [], delivery: [], site: [], dependencies: [] };
    const buf = await renderToBuffer(createElement(PlanDocument, { payload: empty, version: 1, clientReference: "X", title: "T", tz: "UTC", issuedAt: "2099-03-01T08:00:00Z" }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
