/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), redirect: vi.fn() }));
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => null }));
const rpc = vi.fn();
// What the (stand-in) database holds: which company a record belongs to, and each company's Sales settings.
let rows: Record<string, { data?: unknown; error?: { message: string } | null }> = {};
const from = (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => rows[table] ?? { data: null, error: null } }) }) });
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { DueText } from "@/components/sales/badges";
import { WhenFields } from "@/components/sales/follow-up-dialogs";
import { formatDue } from "@/components/sales/format";
import { createFollowUp, rescheduleFollowUp, setFollowUpTimeZone } from "@/lib/actions/crm";
import { dueTimeLabelFor } from "@/app/(app)/sales/new/enquiry-form-shared";
import { groupOpenFollowUps } from "./follow-up-groups";
import { dueFor, dueInZone, followUpZone } from "./follow-up-zone";
import { resultingDue, whenShortcuts } from "./follow-up-reschedule";
import { attentionItems, followUpCounts } from "./reports";
import { enquiryNeeds } from "./enquiry-list";
import { dueTimeLabel, STILL_ON_DUBAI_CLOCK, zoneOfCompanies } from "./time-zone";

// Fictional companies: one on the Dubai clock, one on the Warsaw clock, one with no settings yet.
const UAE = "11111111-1111-4111-8111-111111111111";
const PL = "22222222-2222-4222-8222-222222222222";
const NEW = "33333333-3333-4333-8333-333333333333";
const OPP = "44444444-4444-4444-8444-444444444444";
const FU = "55555555-5555-4555-8555-555555555555";
const WAW = "Europe/Warsaw";
const companies = [{ id: UAE, settings: { follow_up_time_zone: "Asia/Dubai" } }, { id: PL, settings: { follow_up_time_zone: WAW } }, { id: NEW, settings: null }];
const zoneOf = zoneOfCompanies(companies);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { rows = {}; rpc.mockReset().mockResolvedValue({ data: null, error: null }); });

describe("which clock a company's follow-ups use", () => {
  it("is the company's own setting; Dubai for a company without settings, an unknown company and a database without the setting", () => {
    expect([zoneOf(UAE), zoneOf(PL), zoneOf(NEW), zoneOf("unknown"), zoneOf(null)]).toEqual(["Asia/Dubai", WAW, "Asia/Dubai", "Asia/Dubai", "Asia/Dubai"]);
    expect(zoneOfCompanies([{ id: PL, settings: {} }])(PL)).toBe("Asia/Dubai");
    expect(zoneOfCompanies(null)(PL)).toBe("Asia/Dubai");
  });
  it("is named on every time field and after every deadline", () => {
    expect([dueTimeLabel(WAW), dueTimeLabel("Asia/Dubai")]).toEqual(["Time (Warsaw)", "Time (Dubai)"]);
    expect([dueTimeLabelFor({ timeZone: WAW }), dueTimeLabelFor({}), dueTimeLabelFor(null)]).toEqual(["Time (Warsaw)", "Time (Dubai)", "Time"]);
    expect(formatDue("2027-01-15T10:00:00Z", WAW)).toBe("15 Jan 2027, 11:00 (Warsaw)");
    expect(formatDue("2027-01-15T10:00:00Z", "Asia/Dubai")).toBe("15 Jan 2027, 14:00 (Dubai)");
    expect(formatDue(null, WAW)).toBe("—".replace("—", "—"));
  });
});

describe("one list, several companies: each row on its own company's clock", () => {
  // 22:30 on 15 January in Warsaw is 01:30 on the 16th in Dubai. Both follow-ups are due at the same moment: 00:15 on the 16th in Warsaw, 03:15 on the 16th in Dubai.
  const now = new Date("2027-01-15T21:30:00Z");
  const due = "2027-01-15T23:15:00Z";
  const item = (id: string, company_id: string) => ({ id, followUp: { id, due_at: due, status: "open", company_id, assigned_to: "me", title: `Call ${id}` }, opportunity: { id: `o-${id}`, reference: `R-${id}`, title: `Job ${id}` } });

  it("Follow-ups: the Dubai company's row is Today, the Warsaw company's row is Upcoming, at the same moment", () => {
    const g = groupOpenFollowUps([item("uae", UAE), item("pl", PL)], now, zoneOf);
    expect(g.today.map((x) => x.id)).toEqual(["uae"]);
    expect(g.upcoming.map((x) => x.id)).toEqual(["pl"]);
    // without the companies' zones every row is judged on the Dubai day, as before
    expect(groupOpenFollowUps([item("uae", UAE), item("pl", PL)], now).today.map((x) => x.id)).toEqual(["uae", "pl"]);
    expect(followUpCounts([item("uae", UAE).followUp, item("pl", PL).followUp], now, zoneOf)).toEqual({ overdue: 0, dueToday: 1, upcoming: 1 });
  });

  it("My Day: only the row that is due today on its own clock is listed, and it carries its zone for display", () => {
    const list = attentionItems({ opportunities: [], followUps: [item("uae", UAE), item("pl", PL)], userId: "me", scope: "mine", zoneOf }, now);
    expect(list.map((a) => [a.reference, a.kind, a.timeZone])).toEqual([["R-uae", "due_today", "Asia/Dubai"]]);
    // 35 minutes later it is the 16th in Warsaw too
    const later = attentionItems({ opportunities: [], followUps: [item("uae", UAE), item("pl", PL)], userId: "me", scope: "mine", zoneOf }, new Date("2027-01-15T23:05:00Z"));
    expect(later.map((a) => [a.reference, a.kind, a.timeZone])).toEqual([["R-uae", "due_today", "Asia/Dubai"], ["R-pl", "due_today", WAW]]);
    // once the moment has passed both are overdue, whatever the zone
    expect(attentionItems({ opportunities: [], followUps: [item("uae", UAE), item("pl", PL)], userId: "me", scope: "mine", zoneOf }, new Date("2027-01-15T23:16:00Z")).map((a) => a.kind)).toEqual(["overdue", "overdue"]);
  });

  it("Enquiries: the 'due today' need follows the enquiry's own zone", () => {
    const enquiry = (timeZone?: string) => ({ opp: { stage: "qualified", first_response_at: "2027-01-01T00:00:00Z" }, nextFollowUp: { due_at: due }, openFollowUps: 1, ...(timeZone ? { timeZone } : {}) });
    expect(enquiryNeeds(enquiry("Asia/Dubai"), now)).toEqual(["due_today"]);
    expect(enquiryNeeds(enquiry(WAW), now)).toEqual([]);
    expect(enquiryNeeds(enquiry(), now)).toEqual(["due_today"]);
  });

  it("the row shows the time on its own clock with the place, and says due today only where it is", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const uae = renderToStaticMarkup(<DueText dueAt={due} zone="Asia/Dubai" />);
    const pl = renderToStaticMarkup(<DueText dueAt={due} zone={WAW} />);
    expect(uae).toContain("16 Jan 2027, 03:15 (Dubai)");
    expect(uae).toContain("due today");
    expect(pl).toContain("16 Jan 2027, 00:15 (Warsaw)");
    expect(pl).not.toContain("due today");
  });
});

describe("typing a deadline", () => {
  it("the server reads the company from the record, never from the form, and converts on that company's clock", async () => {
    rows = { crm_opportunities: { data: { company_id: PL } }, crm_company_settings: { data: { follow_up_time_zone: WAW } } };
    expect(await followUpZone({ from }, { opportunityId: OPP })).toEqual({ zone: WAW });
    expect(await dueFor({ from }, { opportunityId: OPP }, "2027-01-15", "11:00")).toEqual({ iso: "2027-01-15T10:00:00.000Z", zone: WAW });
    await createFollowUp({ error: null }, fd({ id: OPP, title: "Call", date: "2027-01-15", time: "11:00", timeZone: "Asia/Dubai" }));   // a zone in the form is ignored
    expect(rpc).toHaveBeenCalledWith("crm_create_follow_up", expect.objectContaining({ p_due_at: "2027-01-15T10:00:00.000Z" }));
    rows = { crm_follow_ups: { data: { company_id: UAE } }, crm_company_settings: { data: { follow_up_time_zone: "Asia/Dubai" } } };
    await rescheduleFollowUp({ error: null }, fd({ followUpId: FU, date: "2027-01-15", time: "11:00" }));
    expect(rpc).toHaveBeenLastCalledWith("crm_reschedule_follow_up", { p_follow_up_id: FU, p_due_at: "2027-01-15T07:00:00.000Z" });
  });

  it("a record the person cannot read, a company without settings and an older database use Dubai; a failed read saves nothing and says so", async () => {
    rows = {};
    expect(await followUpZone({ from }, { opportunityId: OPP })).toEqual({ zone: "Asia/Dubai" });
    rows = { crm_opportunities: { data: { company_id: NEW } }, crm_company_settings: { data: null } };
    expect(await followUpZone({ from }, { opportunityId: OPP })).toEqual({ zone: "Asia/Dubai" });
    rows = { crm_opportunities: { data: { company_id: PL } }, crm_company_settings: { data: { reference_code: "POL" } } };
    expect(await followUpZone({ from }, { opportunityId: OPP })).toEqual({ zone: "Asia/Dubai" });
    rows = { crm_opportunities: { data: null, error: { message: "the data service did not answer" } } };
    const r = await createFollowUp({ error: null }, fd({ id: OPP, title: "Call", date: "2027-01-15", time: "11:00" }));
    expect(r.error).toMatch(/Could not check which time zone this company's follow-ups use, so nothing was saved/);
    expect(rpc).not.toHaveBeenCalled();
    rows = { crm_opportunities: { data: { company_id: PL } }, crm_company_settings: { data: null, error: { message: "down" } } };
    expect("error" in (await followUpZone({ from }, { opportunityId: OPP }))).toBe(true);
  });

  it("02:30 on the night the clocks go forward in Warsaw is refused in words, and nothing is sent; the same time for the Dubai company is saved", async () => {
    expect(dueInZone(WAW, "2027-03-28", "02:30")).toEqual({ error: "02:30 does not exist on that date in Warsaw: the clocks go forward that night. Choose another time." });
    expect(dueInZone(WAW, "2027-03-28", "00:15")).toEqual({ iso: "2027-03-27T23:15:00.000Z" });
    expect(dueInZone(WAW, "2027-03-28", undefined)).toEqual({ iso: "2027-03-28T07:00:00.000Z" });            // no time typed: 09:00, as before
    expect(dueInZone(WAW, undefined, "10:00", "Choose a date.")).toEqual({ error: "Choose a date." });
    rows = { crm_opportunities: { data: { company_id: PL } }, crm_company_settings: { data: { follow_up_time_zone: WAW } } };
    const refused = await createFollowUp({ error: null }, fd({ id: OPP, title: "Call", date: "2027-03-28", time: "02:30" }));
    expect(refused.error).toMatch(/02:30 does not exist on that date in Warsaw/);
    expect(rpc).not.toHaveBeenCalled();
    rows = { crm_opportunities: { data: { company_id: UAE } }, crm_company_settings: { data: { follow_up_time_zone: "Asia/Dubai" } } };
    expect((await createFollowUp({ error: null }, fd({ id: OPP, title: "Call", date: "2027-03-28", time: "02:30" }))).error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("crm_create_follow_up", expect.objectContaining({ p_due_at: "2027-03-27T22:30:00.000Z" }));
  });

  it("the form previews exactly what will be saved, on the company's clock, and 'Tomorrow' is the next date there even across the clock change", () => {
    // 21:00 on Saturday 27 March 2027 in Warsaw (the 28th has already begun in Dubai).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-27T20:00:00Z"));
    expect(whenShortcuts(new Date(), WAW).map((s) => s.date)).toEqual(["2027-03-28", "2027-03-29", "2027-04-03"]);
    expect(whenShortcuts(new Date()).map((s) => s.date)).toEqual(["2027-03-29", "2027-03-30", "2027-04-04"]);
    expect(resultingDue("2027-03-28", "10:00", WAW)).toBe("2027-03-28T08:00:00.000Z");
    expect(resultingDue("2027-03-28", "02:30", WAW)).toBeNull();
    render(<WhenFields id="t" dateName="date" timeName="time" zone={WAW} />);
    expect(screen.getByLabelText("Time (Warsaw)")).toBeTruthy();
    expect((screen.getByLabelText("Date") as HTMLInputElement).min).toBe("2027-03-27");
    fireEvent.click(screen.getByTestId("when-tomorrow"));
    expect(screen.getByTestId("when-result").textContent).toBe("Will be due Sun, 28 Mar 2027, 10:00 (Warsaw time)");
    fireEvent.change(screen.getByLabelText("Time (Warsaw)"), { target: { value: "02:30" } });
    expect(screen.getByTestId("when-skipped").textContent).toMatch(/does not exist on that date in Warsaw: the clocks go forward that night/);
    fireEvent.change(screen.getByLabelText("Time (Warsaw)"), { target: { value: "03:00" } });
    expect(screen.getByTestId("when-result").textContent).toBe("Will be due Sun, 28 Mar 2027, 03:00 (Warsaw time)");
  });
});

describe("changing a company's zone", () => {
  it("sends the named zone to the database function; an offset or an unknown name is refused before anything is sent; an older database says so", async () => {
    expect((await setFollowUpTimeZone({ error: null }, fd({ companyId: PL, timeZone: WAW }))).error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("crm_set_follow_up_time_zone", { p_company_id: PL, p_time_zone: WAW });
    rpc.mockClear();
    for (const bad of ["+01:00", "UTC+1", "Etc/GMT+1", "CET", "Europe/Atlantis"]) expect((await setFollowUpTimeZone({ error: null }, fd({ companyId: PL, timeZone: bad }))).error, bad).toMatch(/Choose a time zone by its name/);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "Not allowed to change CRM settings for this company" } });
    expect((await setFollowUpTimeZone({ error: null }, fd({ companyId: PL, timeZone: WAW }))).error).toMatch(/Not allowed/);
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.crm_set_follow_up_time_zone in the schema cache" } });
    expect((await setFollowUpTimeZone({ error: null }, fd({ companyId: PL, timeZone: WAW }))).error).toMatch(/not available in this environment yet/);
  });
});

describe("a company that moves from the Dubai clock to its own (the Polish and the Saudi company on rollout)", () => {
  const RUH = "Asia/Riyadh";
  // Typed before the change as "15 Jan 2027, 10:00 (Dubai)" = 06:00 UTC. The stored moment is never rewritten.
  const typedAsTenDubai = "2027-01-15T06:00:00.000Z";
  // Typed as 01:30 (Dubai) on the 16th = 21:30 UTC on the 15th = 22:30 on the 15th in Warsaw = 00:30 on the 16th in Riyadh.
  const lateNight = "2027-01-15T21:30:00.000Z";
  const item = (id: string, company_id: string, due_at: string) => ({ id, followUp: { id, due_at, status: "open", company_id, assigned_to: "me", title: id }, opportunity: { id: `o-${id}`, reference: `R-${id}`, title: id } });
  const KSA = "66666666-6666-4666-8666-666666666666";
  const zones = zoneOfCompanies([...companies, { id: KSA, settings: { follow_up_time_zone: RUH } }]);

  it("the same moment reads 10:00 (Dubai), 09:00 (Riyadh) and 07:00 (Warsaw) in winter, 08:00 (Warsaw) in summer", () => {
    expect(formatDue(typedAsTenDubai, "Asia/Dubai")).toBe("15 Jan 2027, 10:00 (Dubai)");
    expect(formatDue(typedAsTenDubai, RUH)).toBe("15 Jan 2027, 09:00 (Riyadh)");
    expect(formatDue(typedAsTenDubai, WAW)).toBe("15 Jan 2027, 07:00 (Warsaw)");
    expect(formatDue("2027-07-15T06:00:00.000Z", WAW)).toBe("15 Jul 2027, 08:00 (Warsaw)");
  });

  it("a deadline typed late at night in Dubai falls on the day before in Warsaw: it is shown that way and grouped by the company's own day", () => {
    expect(formatDue(lateNight, "Asia/Dubai")).toBe("16 Jan 2027, 01:30 (Dubai)");
    expect(formatDue(lateNight, WAW)).toBe("15 Jan 2027, 22:30 (Warsaw)");
    expect(formatDue(lateNight, RUH)).toBe("16 Jan 2027, 00:30 (Riyadh)");
    // 20:00 on the 15th in Warsaw (23:00 in Dubai, 22:00 in Riyadh): the same moment is Today for Warsaw, Upcoming (tomorrow) for Dubai and Riyadh
    const evening = new Date("2027-01-15T19:00:00.000Z");
    const g = groupOpenFollowUps([item("uae", UAE, lateNight), item("pl", PL, lateNight), item("ksa", KSA, lateNight)], evening, zones);
    expect(g.today.map((x) => x.id)).toEqual(["pl"]);
    expect(g.upcoming.map((x) => x.id).sort()).toEqual(["ksa", "uae"]);
    // My Day lists only what is due today on its own clock; each row carries its zone
    const mine = attentionItems({ opportunities: [], followUps: [item("uae", UAE, lateNight), item("pl", PL, lateNight), item("ksa", KSA, lateNight)], userId: "me", scope: "mine", zoneOf: zones }, evening);
    expect(mine.map((a) => [a.reference, a.kind, a.timeZone])).toEqual([["R-pl", "due_today", WAW]]);
    // overdue never depends on the zone: one minute after the moment all three are overdue
    const after = attentionItems({ opportunities: [], followUps: [item("uae", UAE, lateNight), item("pl", PL, lateNight), item("ksa", KSA, lateNight)], userId: "me", scope: "mine", zoneOf: zones }, new Date("2027-01-15T21:31:00.000Z"));
    expect(after.map((a) => a.kind)).toEqual(["overdue", "overdue", "overdue"]);
  });

  it("says plainly what still runs on the Dubai clock", () => {
    expect(STILL_ON_DUBAI_CLOCK).toMatch(/hold's review date/);
    expect(STILL_ON_DUBAI_CLOCK).toMatch(/no next action/);
    expect(STILL_ON_DUBAI_CLOCK).toMatch(/Sales reports/);
    expect(STILL_ON_DUBAI_CLOCK).toMatch(/JARVIS/);
  });
});
