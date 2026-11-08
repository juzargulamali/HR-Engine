/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/sales/follow-ups", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/workspace/clickable-row", () => ({ ClickableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr> }));
vi.mock("@/components/workspace/panel-link", () => ({ PanelLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/sales/follow-up-row-actions", () => ({ FollowUpRowActions: () => null }));
vi.mock("@/components/sales/quick-add-enquiry", () => ({ QuickAddEnquiry: () => null }));
vi.mock("@/components/sales/handover-attention", () => ({ HandoverAttention: () => null }));
vi.mock("../mark-reminders-read", () => ({ MarkRemindersReadButton: () => null }));
vi.mock("../_panel/enquiry-panel", () => ({ EnquirySidePanel: () => null }));
vi.mock("@/lib/crm/reminders", () => ({ generateRemindersThrottled: async () => undefined }));
vi.mock("@/lib/crm/handover-attention-data", () => ({ loadHandoverRows: async () => ({ status: "ok", rows: [] }) }));
const ctx = { userId: "u1", grants: [{ companyId: "c1", capabilities: [] }], personName: () => "Sales Owner", companyName: () => "Enginious UAE" };
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));

const HOUR = 3_600_000;
const row = (id: string, title: string, dueOffsetHours: number, assignedTo = "u1") => ({
  followUp: { id, title, kind: "call", status: "open", due_at: new Date(Date.now() + dueOffsetHours * HOUR).toISOString(), assigned_to: assignedTo, opportunity_id: `o-${id}`, created_by: "u1", company_id: "c1" },
  opportunity: { id: `o-${id}`, reference: `OPP-UAE-2026-000${id}`, title: `Enquiry ${title}`, stage: "new", company_id: "c1", owner_id: "u1" },
  account: null, assigneeName: "Sales Owner", party: "Zeta Media",
});
let open: ReturnType<typeof row>[] = [];
let failed = false;
vi.mock("@/lib/crm/data", () => ({
  loadFollowUps: async () => { if (failed) throw new Error("down"); return { open, done: [] }; },
  loadMyReminders: async () => [],
  loadOpportunities: async () => [],
}));

import FollowUpsPage from "./page";
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await FollowUpsPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  failed = false;
  // one overdue, one due now (today in Dubai), one upcoming; a fourth belonging to a colleague and also due today
  open = [row("1", "Overdue call", -48), row("2", "Today call", 0), row("3", "Upcoming call", 72), row("4", "Colleague today call", 0, "u2")];
});

describe("Follow-ups page and the My Day link ?view=today", () => {
  it("My Day links to /sales/follow-ups?view=today (the address this page must honour)", async () => {
    const { salesCandidates } = await import("@/lib/my-day/attention");
    const items = salesCandidates({ attention: [{ kind: "due_today", followUpId: "f1", opportunityId: "o", title: "T", reference: "R", detail: "d", at: null }] } as never, () => "x");
    expect(items[0]!.href).toBe("/sales/follow-ups?view=today");
  });

  it("the ordinary page shows Overdue, Today and Upcoming (unchanged)", async () => {
    const html = await render();
    expect(html).toContain("Overdue call");
    expect(html).toContain("Today call");
    expect(html).toContain("Upcoming call");
    expect(html).not.toContain("Showing only what is due today");
    expect(html).not.toContain("Colleague today call"); // Mine is the default
  });

  it("?view=today lands on the Today view: only today's follow-ups of the person, a note, and a way back to the whole list", async () => {
    const html = await render({ view: "today" });
    expect(html).toContain("Today call");
    expect(html).not.toContain("Overdue call");
    expect(html).not.toContain("Upcoming call");
    expect(html).not.toContain("Colleague today call");
    expect(html).toContain("Showing only what is due today");
    expect(html).toMatch(/href="\/sales\/follow-ups"[^>]*>Show all to-do/);
    expect(html).toContain("Today <span");
    expect(html).not.toMatch(/>Overdue <span/);
  });

  it("?view=today with who=all keeps the Everyone choice and includes a colleague's follow-up due today", async () => {
    const html = await render({ view: "today", who: "all" });
    expect(html).toContain("Today call");
    expect(html).toContain("Colleague today call");
    expect(html).not.toContain("Overdue call");
    expect(html).toMatch(/href="\/sales\/follow-ups\?who=all"[^>]*>Show all to-do/);
  });

  it("?view=today says so when nothing is due today (not an empty page)", async () => {
    open = [row("1", "Overdue call", -48), row("3", "Upcoming call", 72)];
    const html = await render({ view: "today" });
    expect(html).toContain("Nothing is due today");
    expect(html).toContain("Show all to-do");
    expect(html).not.toContain("Overdue call");
  });

  it("an unknown view value is the ordinary to-do view, and view=done is untouched", async () => {
    expect(await render({ view: "whatever" })).toContain("Overdue call");
    expect(await render({ view: "done" })).toContain("No completed follow-ups yet");
  });

  it("a failed read is still 'Could not load follow-ups' for the Today view too", async () => {
    failed = true;
    expect(await render({ view: "today" })).toContain("Could not load follow-ups");
  });
});
