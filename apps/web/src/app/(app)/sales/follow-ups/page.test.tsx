/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/sales/follow-ups", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/workspace/clickable-row", () => ({ ClickableRow: ({ children, id, ...rest }: { children: React.ReactNode; id?: string; "data-focused"?: string }) => <tr id={id} data-focused={rest["data-focused"]}>{children}</tr> }));
vi.mock("@/components/workspace/panel-link", () => ({ PanelLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/sales/follow-up-row-actions", () => ({ FollowUpRowActions: () => null }));
vi.mock("@/components/sales/quick-add-enquiry", () => ({ QuickAddEnquiry: () => null }));
vi.mock("@/components/sales/handover-attention", () => ({ HandoverAttention: () => null }));
vi.mock("../mark-reminders-read", () => ({ MarkRemindersReadButton: ({ reminderIds, label = "Mark all read" }: { reminderIds?: string[]; label?: string }) => <button data-ids={(reminderIds ?? ["ALL"]).join(",")}>{label}</button> }));
vi.mock("../_panel/enquiry-panel", () => ({ EnquirySidePanel: () => null }));
vi.mock("@/lib/crm/reminders", () => ({ generateRemindersThrottled: async () => undefined }));
vi.mock("@/lib/crm/handover-attention-data", () => ({ loadHandoverRows: async () => ({ status: "ok", rows: [] }) }));
const UAE = { id: "11111111-1111-4111-8111-111111111111", name: "Fictional UAE" };
const EU = { id: "22222222-2222-4222-8222-222222222222", name: "Fictional Europe" };
const ctx = { userId: "u1", grants: [{ companyId: "c1", capabilities: [] }], companies: [UAE] as { id: string; name: string }[], personName: () => "Sales Owner", companyName: (id: string) => (id === EU.id ? EU.name : UAE.name) };
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));

const HOUR = 3_600_000;
const row = (id: string, title: string, dueOffsetHours: number, assignedTo = "u1") => ({
  followUp: { id, title, kind: "call", status: "open", due_at: new Date(Date.now() + dueOffsetHours * HOUR).toISOString(), assigned_to: assignedTo, opportunity_id: `o-${id}`, created_by: "u1", company_id: "c1" },
  opportunity: { id: `o-${id}`, reference: `OPP-UAE-2026-000${id}`, title: `Enquiry ${title}`, stage: "new", company_id: "c1", owner_id: "u1" },
  account: null, assigneeName: "Sales Owner", party: "Zeta Media",
});
let open: ReturnType<typeof row>[] = [];
let done: unknown[] = [];
let opportunities: unknown[] = [];
let reminders: unknown[] = [];
// Well-formed ids for the rows a link can point at (`focus` only accepts a record id).
const F1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const F2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const reminder = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: "follow_up_due", title: "Chase the fictional agency", opportunity_id: `o-${F1}`, follow_up_id: F1, company_id: "c1", due_at: null, read_at: null, created_at: "2026-11-08T06:00:00Z", ...over });
let failed = false;
vi.mock("@/lib/crm/data", () => ({
  loadFollowUps: async () => { if (failed) throw new Error("down"); return { open, done }; },
  loadMyReminders: async () => reminders,
  loadOpportunities: async () => opportunities,
}));

import FollowUpsPage from "./page";
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await FollowUpsPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  // A fixed clock (10:00 in Dubai): a follow-up is "due today" only while its moment is still to come on today's Dubai date, so rows are set a couple of hours ahead.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T06:00:00Z"));
  failed = false; reminders = []; done = []; opportunities = []; ctx.companies = [UAE];
  // one overdue, one due now (today in Dubai), one upcoming; a fourth belonging to a colleague and also due today
  open = [row("1", "Overdue call", -48), row("2", "Today call", 2), row("3", "Upcoming call", 72), row("4", "Colleague today call", 2, "u2")];
});

afterEach(() => { vi.useRealTimers(); });

describe("Follow-ups page and the My Day link ?view=today", () => {
  it("My Day links to the group and the exact follow-up (the address this page must honour), and the page honours it", async () => {
    const { salesCandidates } = await import("@/lib/my-day/attention");
    open = [row(F1, "Overdue call", -48), row(F2, "Today call", 2), row("3", "Upcoming call", 72)];
    const items = salesCandidates({ attention: [{ kind: "due_today", followUpId: F2, opportunityId: "o", title: "T", reference: "R", detail: "d", at: null }, { kind: "overdue", followUpId: F1, opportunityId: "o", title: "T", reference: "R", detail: "d", at: null }] } as never, () => "x");
    expect(items.map((i) => i.href)).toEqual([`/sales/follow-ups?view=today&focus=${F2}`, `/sales/follow-ups?view=overdue&focus=${F1}`]);
    const today = await render({ view: "today", focus: F2 });
    expect(today).toMatch(new RegExp(`id="follow-up-${F2}"[^>]*data-focused="true"`));
    expect(today).toContain("Opened from your link");
    expect(today).not.toContain("Overdue call");
    const overdue = await render({ view: "overdue", focus: F1 });
    expect(overdue).toContain("Showing only what is overdue.");
    expect(overdue).toMatch(new RegExp(`id="follow-up-${F1}"[^>]*data-focused="true"`));
    expect(overdue).not.toContain("Today call");
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
    // The summary cards stay, with the real numbers, and the active one turns the narrowing off again.
    expect(html).toMatch(/<a(?=[^>]*href="\/sales\/follow-ups")(?=[^>]*aria-current="true")(?=[^>]*data-testid="follow-ups-today")/);
  });

  it("?view=today leaves out the whole-list cards (reminders, needs attention) that the ordinary page shows, so the landing is the Today rows only", async () => {
    reminders = [{ id: "r1", kind: "follow_up_due", title: "Overdue chase", opportunity_id: "o-1", follow_up_id: null, company_id: "c1", due_at: null, read_at: null, created_at: new Date().toISOString() }];
    const ordinary = await render();
    expect(ordinary).toContain("Reminders (1 unread)");
    const today = await render({ view: "today" });
    expect(today).not.toContain("Reminders (");
    expect(today).toContain("Today call");
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

describe("the action-first summary", () => {
  it("Overdue, Today and Upcoming are counted from the rows listed, and each card narrows the list to its group", async () => {
    const html = await render();
    for (const [g, n] of [["overdue", 1], ["today", 1], ["upcoming", 1]] as const) {
      expect(html).toMatch(new RegExp(`<a(?=[^>]*href="/sales/follow-ups\\?view=${g}")(?=[^>]*data-testid="follow-ups-${g}")`));
      expect(html).toMatch(new RegExp(`data-testid="follow-ups-${g}".*?tabular-nums">${n}<`));
    }
    expect(html).toContain("To do (3)");
    // Everyone: the colleague's follow-up due today is counted too.
    expect(await render({ who: "all" })).toMatch(/data-testid="follow-ups-today".*?tabular-nums">2</);
  });

  it("view=overdue and view=upcoming narrow like view=today, each with its note and a way back", async () => {
    const overdue = await render({ view: "overdue" });
    expect(overdue).toContain("Overdue call");
    expect(overdue).not.toContain("Today call");
    expect(overdue).toContain("Showing only what is overdue.");
    const upcoming = await render({ view: "upcoming" });
    expect(upcoming).toContain("Upcoming call");
    expect(upcoming).not.toContain("Overdue call");
    open = [row("2", "Today call", 2)];
    expect(await render({ view: "overdue" })).toContain("Nothing is overdue");
  });

  it("a row shows the next action, the enquiry with its reference and client, the owner and the exact due date and time; the wording about a 1,000 limit is gone", async () => {
    const html = await render();
    expect(html).toContain("Overdue call");
    expect(html).toContain("Enquiry Overdue call");
    expect(html).toContain("OPP-UAE-2026-0001");
    expect(html).toContain("Zeta Media");
    expect(html).toContain("Sales Owner");
    // 7 Nov 2026 06:00 UTC is 10:00 in Dubai.
    expect(html).toContain("7 Nov 2026, 10:00");
    expect(html).toContain("overdue 2d");
    expect(html).not.toContain("first 1,000");
    // Every cell after the title carries its label for the phone card.
    expect(html).toContain('data-label="Enquiry"');
    expect(html).toContain('data-label="Due"');
    expect(html).toContain('data-label="Owner"');
  });

  it("a row the person cannot change says 'View only', with the reason behind the ⓘ rather than a sentence in the row", async () => {
    open = [{ ...row("1", "Colleague call", 2, "u2"), opportunity: { ...row("1", "Colleague call", 2).opportunity, owner_id: "u3" } }];
    const html = await render({ who: "all" });
    expect(html).toContain("View only");
    expect(html).toContain("why you cannot change this follow-up");
    expect(html).not.toContain("Only the assignee, the owner");
  });
});

describe("one current reminder per follow-up", () => {
  beforeEach(() => { open = [row(F1, "Overdue call", -48), row(F2, "Today call", 2)]; });

  it("a due and an overdue row about the same follow-up show as ONE reminder (overdue), and Dismiss carries both rows", async () => {
    reminders = [reminder("r-due", { due_at: open[0]!.followUp.due_at }), reminder("r-over", { kind: "follow_up_overdue", due_at: open[0]!.followUp.due_at })];
    const html = await render();
    expect(html).toContain("Reminders (1 unread)");
    expect(html.match(/data-testid="reminder"/g)).toHaveLength(1);
    expect(html).toContain("Follow-up overdue");
    expect(html).not.toContain(">Follow-up due<");
    expect(html).toMatch(/data-ids="r-due,r-over"[^>]*>Dismiss/);
    expect(html).toMatch(/data-ids="ALL"[^>]*>Mark all read/);
  });

  it("the reminder links to the exact follow-up row, and opening that link marks the row", async () => {
    reminders = [reminder("r-due")];
    const html = await render();
    expect(html).toContain(`href="/sales/follow-ups?focus=${F1}"`);
    const focused = await render({ focus: F1 });
    expect(focused).toMatch(new RegExp(`id="follow-up-${F1}"[^>]*data-focused="true"`));
    expect(focused).not.toMatch(new RegExp(`id="follow-up-${F2}"[^>]*data-focused`));
  });

  it("a reminder for a follow-up that is no longer open, or that was written for an earlier due time, is not shown", async () => {
    reminders = [reminder("r-gone", { follow_up_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9" }), reminder("r-stale", { follow_up_id: F2, due_at: "2026-11-01T06:00:00Z" })];
    const html = await render();
    expect(html).not.toContain("Reminders (");
  });

  it("reminders about two different follow-ups stay two", async () => {
    reminders = [reminder("r1"), reminder("r2", { follow_up_id: F2, opportunity_id: `o-${F2}` })];
    const html = await render();
    expect(html).toContain("Reminders (2 unread)");
    expect(html.match(/data-testid="reminder"/g)).toHaveLength(2);
  });

  it("the explanation of reminders is behind the ⓘ, not a footnote", async () => {
    reminders = [reminder("r1")];
    expect(await render()).not.toContain("they are not instant alerts");
  });
});

describe("opening a follow-up from a link (?focus)", () => {
  it("shows the follow-up even when the current filter would leave it out, and says so", async () => {
    open = [row("1", "My call", 2), row(F1, "Colleague call", 2, "u2")];
    const html = await render({ focus: F1 });
    expect(html).toContain("Colleague call");
    expect(html).toMatch(/data-testid="follow-ups-focus-outside"/);
    expect(html).toContain("outside the current filter");
    expect(await render()).not.toContain("Colleague call");
  });

  it("a link that names a group the follow-up has left shows the whole list rather than hiding the row", async () => {
    open = [row(F1, "Now overdue call", -3), row("2", "Today call", 2)];
    const html = await render({ view: "today", focus: F1 });
    expect(html).toContain("Now overdue call");
    expect(html).toContain("Today call");
    expect(html).not.toContain("Showing only what is due today");
  });

  it("falls back to the enquiry when the follow-up has been completed, and says it is gone when it cannot be found", async () => {
    done = [{ ...row(F1, "Finished call", -30), followUp: { ...row(F1, "Finished call", -30).followUp, status: "done", completed_at: "2026-11-08T06:00:00Z", outcome: "Spoke to them" } }];
    const completed = await render({ focus: F1 });
    expect(completed).toContain("That follow-up has been completed.");
    expect(completed).toContain(`open=o-${F1}`);
    expect(completed).toContain("Open the enquiry: Enquiry Finished call");
    done = [];
    const gone = await render({ focus: F1 });
    expect(gone).toContain("That follow-up is no longer open, or you can no longer see it.");
    // A malformed id is ignored: no notice, the ordinary list.
    expect(await render({ focus: "nope" })).not.toContain("That follow-up");
  });

  it("falls back to the account for a completed follow-up on an account with no enquiry", async () => {
    done = [{ followUp: { id: F1, title: "Intro call", kind: "call", status: "done", due_at: "2026-11-01T06:00:00Z", completed_at: "2026-11-08T06:00:00Z", outcome: "Done", assigned_to: "u1", opportunity_id: null, created_by: "u1", company_id: UAE.id }, opportunity: null, account: { id: "acc-1", name: "Fictional Quiet Account", companyId: UAE.id }, assigneeName: "Sales Owner", party: "Fictional Quiet Account" }];
    const html = await render({ focus: F1 });
    expect(html).toContain("Open the account: Fictional Quiet Account");
    expect(html).toContain(`/sales/accounts/acc-1?company=${UAE.id}&amp;from=follow-ups`);
  });
});

describe("company", () => {
  const inCo = (r: ReturnType<typeof row>, companyId: string) => ({ ...r, followUp: { ...r.followUp, company_id: companyId } });
  beforeEach(() => {
    ctx.companies = [UAE, EU];
    open = [inCo(row("1", "UAE call", 2), UAE.id), inCo(row("2", "Europe call", 2), EU.id), inCo(row("3", "Europe chase", -30), EU.id)];
  });

  it("with several companies the default is all of them (nothing of the person's is hidden), with the company on each row", async () => {
    const html = await render();
    expect(html).toContain("UAE call");
    expect(html).toContain("Europe call");
    expect(html).toMatch(/aria-current="page"[^>]*>All my companies/);
    expect(html).toContain("· Fictional Europe");
    expect(html).not.toMatch(/data-testid="follow-ups-other-companies"/);
  });

  it("choosing a company narrows the list and says how many of the person's follow-ups are in their other companies, with a link to them", async () => {
    const html = await render({ company: UAE.id });
    expect(html).toContain("UAE call");
    expect(html).not.toContain("Europe call");
    expect(html).toContain("To do (1)");
    expect(html).toContain("2 more of your open follow-ups are in your other companies.");
    expect(html).toMatch(/href="\/sales\/follow-ups"[^>]*>Show all my companies/);
    expect(html).toMatch(new RegExp(`data-company-id="${UAE.id}"`));
  });

  it("a company the person has no Sales access to is ignored (all companies), and one company shows its name without a chooser", async () => {
    expect(await render({ company: "33333333-3333-4333-8333-333333333333" })).toContain("Europe call");
    ctx.companies = [UAE];
    const html = await render();
    expect(html).toContain("Fictional UAE");
    expect(html).not.toContain("All my companies");
  });
});

describe("needs attention and recently completed", () => {
  it("'Open Enquiries to see the rest' is a link to the enquiries of the same people", async () => {
    opportunities = Array.from({ length: 10 }, (_, i) => ({ opp: { id: `o-n${i}`, reference: `OPP-FIC-${i}`, title: `Fictional enquiry ${i}`, stage: "new", owner_id: "u1", company_id: "c1", first_response_at: "2026-11-01T00:00:00Z", hold_review_date: null }, openFollowUps: 0 }));
    const html = await render();
    expect(html).toContain("Showing 8 of 10.");
    expect(html).toMatch(/href="\/sales\/opportunities\?owner=me"[^>]*>Open Enquiries to see the rest/);
    expect(await render({ who: "all" })).toMatch(/href="\/sales\/opportunities"[^>]*>Open Enquiries to see the rest/);
  });

  it("recently completed labels every cell after the title for the phone card", async () => {
    done = [{ ...row("9", "Finished call", -30), followUp: { ...row("9", "Finished call", -30).followUp, status: "done", completed_at: "2026-11-08T06:00:00Z", outcome: "Spoke to them" } }];
    const html = await render({ view: "done" });
    expect(html).toContain("Spoke to them");
    for (const label of ["Enquiry", "Completed", "What happened"]) expect(html).toContain(`data-label="${label}"`);
    expect(html).toContain("8 Nov 2026, 10:00");
  });
});
