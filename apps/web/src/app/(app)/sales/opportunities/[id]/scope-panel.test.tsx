/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./edit-details", () => ({ EditDetailsButton: () => "ACTION:edit" as unknown as null }));
vi.mock("./event-fact", () => ({ EventFact: () => null }));

import { ScopePanel } from "./scope-panel";
import { buildOppView } from "./view";

// Fictional data only.
const opp = { id: "o1", company_id: "c1", owner_id: "u1", stage: "qualified", currency: "AED", version: 1, technologies: [{ name: "LED wall", qty: 2 }], risks: [], scope: null, exclusions: null, event_start: "2027-03-01", event_end: null, install_start: null, location: null, budget_note: null, payment_terms: null, waiting_on: null, availability_at: "2026-11-02T08:00:00Z", event_edition_id: null };
const owner = { userId: "u1", grants: [{ companyId: "c1", capabilities: ["founder"] }], companies: [{ id: "c1", name: "Fictional Co", settings: null }], people: [], personName: () => "Fictional Fiona", companyName: () => "Fictional Co" };
const html = (availability: string, ctx: unknown = owner, compact = false) => renderToStaticMarkup(<ScopePanel compact={compact} view={buildOppView(ctx as never, {
  item: { opp, value: 100, companyName: "Fictional Co", ownerName: "Fictional Fiona", agency: null, client: null, nextFollowUp: null, openFollowUps: 0, availability },
  contacts: [], activities: [], followUps: [], events: [], files: [], proposals: [], zoho: null, approvals: [], handover: null, closures: [], estimateSends: [], estimateSendsInstalled: true,
} as never)} />);

describe("Scope & dates", () => {
  it("has its own Edit at the top of the tab for the owner or a founder, and says who can for anyone else", () => {
    expect(html("unverified").match(/ACTION:edit/g)).toHaveLength(1);
    const other = html("unverified", { ...owner, userId: "u2", grants: [{ companyId: "c1", capabilities: [] }] });
    expect(other).not.toContain("ACTION:edit");
    expect(other).toContain("Only the owner (Fictional Fiona) or a founder can change them.");
  });
  it("says visibly when changed dates or quantities mean availability must be checked again, with the way to Commercial", () => {
    const stale = html("needs_recheck");
    expect(stale).toContain("Availability must be checked again.");
    expect(stale).toContain("changed after the last check (2 Nov 2026)");
    expect(stale).toContain('href="/sales/opportunities/o1?tab=commercial"');
    expect(stale).toContain("Open Commercial to request a new check");
    const fine = html("confirmed");
    expect(fine).not.toContain("Availability must be checked again.");
    expect(fine).toContain("change the dates, technologies or quantities and the check must be repeated");
  });
  it("the side panel keeps its Edit beside the Scope heading and names Commercial without a tab link", () => {
    const compact = html("needs_recheck", owner, true);
    expect(compact.match(/ACTION:edit/g)).toHaveLength(1);
    expect(compact).toContain("Request a new check under Commercial.");
  });
});
