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
  it("renders an empty version without failing", async () => {
    const { PlanDocument } = await import("./plan-document");
    const empty = { ...payload, milestones: [], delivery: [], site: [], dependencies: [] };
    const buf = await renderToBuffer(createElement(PlanDocument, { payload: empty, version: 1, clientReference: "X", title: "T", tz: "UTC", issuedAt: "2099-03-01T08:00:00Z" }) as Parameters<typeof renderToBuffer>[0]);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
