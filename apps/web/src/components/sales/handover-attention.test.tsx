/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { HandoverAttention } from "./handover-attention";
import type { HandoverRow } from "@/lib/crm/handover-attention";

const row = (kind: HandoverRow["kind"], scope: HandoverRow["scope"] = "mine"): HandoverRow => ({ kind, opportunityId: "o1", reference: "UAE-1", title: "Expo build", detail: "The Project Manager asked: Which hall?", scope, at: null });

describe("HandoverAttention (Sales Follow-ups)", () => {
  it("lists each row with its words and a link to that enquiry's handover page", () => {
    const html = renderToStaticMarkup(<HandoverAttention check={{ status: "ok", rows: [row("handover_question"), row("won_no_handover", "company")] }} />);
    expect(html).toContain("Handover: the PM asked a question");
    expect(html).toContain("Won, handover not submitted");
    expect(html).toContain("other owner");
    expect(html).toContain('href="/sales/opportunities/o1/handover"');
    expect(html).toContain("Which hall?");
  });
  it("a failed read says 'Could not check handovers', never an empty card", () => {
    const html = renderToStaticMarkup(<HandoverAttention check={{ status: "error" }} />);
    expect(html).toContain("Could not check handovers");
  });
  it("renders nothing when there is nothing to do or Projects is not installed", () => {
    expect(renderToStaticMarkup(<HandoverAttention check={{ status: "ok", rows: [] }} />)).toBe("");
    expect(renderToStaticMarkup(<HandoverAttention check={{ status: "none" }} />)).toBe("");
  });
});
