/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/crmHandoverNotice", () => ({ dismissHandoverNotice: vi.fn() }));
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
  it("offers Dismiss only on a 'Handover accepted' notice that has something to dismiss", () => {
    const html = renderToStaticMarkup(<HandoverAttention check={{ status: "ok", rows: [{ ...row("handover_accepted"), noticeId: "n1" }, { ...row("handover_question"), opportunityId: "o2" }, { ...row("won_no_handover"), opportunityId: "o3" }, { ...row("handover_accepted"), opportunityId: "o4" }] }} />);
    expect(html.match(/data-testid="dismiss-handover-notice"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Dismiss the handover accepted notice for Expo build"');
  });
});
